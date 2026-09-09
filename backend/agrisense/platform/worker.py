"""Durable job and outbox execution.

Work is leased rather than deleted on pickup, so a worker that dies mid-job releases its
claim instead of losing it. Attempts back off and end in a dead letter that stays visible.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import timedelta

from sqlalchemy import or_, select
from sqlalchemy.orm import Session, sessionmaker

from agrisense.config import Settings
from agrisense.contracts_generated import models as c
from agrisense.platform import assistant, reminders, science
from agrisense.platform import db as d
from agrisense.platform.errors import PlatformError

log = logging.getLogger('agrisense.platform.worker')
MAX_ATTEMPTS = 5
LEASE = timedelta(minutes=5)
BACKOFF_SECONDS = 30


def backoff(attempts: int) -> timedelta:
    return timedelta(seconds=min(BACKOFF_SECONDS * 2 ** max(attempts - 1, 0), 3600))


def claim_job(session: Session, token: str) -> d.JobRow | None:
    """Take one due job under a row lock so two workers cannot hold the same claim."""
    now = d.utcnow()
    row = session.scalar(
        select(d.JobRow)
        .where(d.JobRow.status.in_(('pending', 'running')), d.JobRow.run_after <= now,
               or_(d.JobRow.lease_until.is_(None), d.JobRow.lease_until < now))
        .order_by(d.JobRow.run_after)
        .limit(1)
        .with_for_update(skip_locked=True))
    if row is None:
        return None
    row.status = 'running'
    row.attempts += 1
    row.lease_token = token
    row.lease_until = now + LEASE
    row.updated_at = now
    session.flush()
    return row


def finish(session: Session, row: d.JobRow, *, result_id: str | None = None, error: PlatformError | None = None) -> None:
    now = d.utcnow()
    row.updated_at = now
    row.lease_until = None
    row.lease_token = None
    if error is None:
        row.status = 'succeeded'
        row.payload = {**row.payload, 'result_id': result_id}
        return
    detail = c.ErrorDetail(code=error.code, message=error.message, details=error.details, retryable=error.retryable)
    row.payload = {**row.payload, 'error': detail.model_dump(mode='json')}
    if error.retryable and row.attempts < MAX_ATTEMPTS:
        row.status = 'pending'
        row.run_after = now + backoff(row.attempts)
    else:
        # A dead letter stays queryable; it is never dropped or silently retried forever.
        row.status = 'dead_letter' if row.attempts >= MAX_ATTEMPTS else 'failed'


async def run_job(session: Session, row: d.JobRow, settings: Settings) -> str | None:
    request = row.payload.get('request', {})
    if row.kind == 'science.evaluate':
        season = session.scalar(select(d.SeasonRow).where(
            d.SeasonRow.id == request['season_id'], d.SeasonRow.tenant_id == row.tenant_id))
        if season is None:
            raise PlatformError('SEASON_MISSING', 'This season no longer exists.', 404)
        bundle, forecast, snapshot = await science.evaluate(session, row.tenant_id, season.id)
        stored = science.store_evaluation(session, row.tenant_id, row.farmer_id, season, bundle, snapshot, forecast)
        return stored.id
    if row.kind == 'assistant.reply':
        message = assistant.reply(session, settings, row.tenant_id, row.farmer_id,
                                  request['conversation_id'], request['message_id'])
        return message.id
    if row.kind in ('privacy.export', 'privacy.delete', 'soil.extract'):
        raise PlatformError('DEPENDENCY_UNAVAILABLE', f'{row.kind} is not available yet.', 503, True)
    raise PlatformError('UNKNOWN_JOB_KIND', f'No handler for {row.kind}.', 422)


async def drain_jobs(sessions: sessionmaker, settings: Settings, limit: int = 10) -> int:
    """Each job commits on its own so one failure cannot roll back its neighbours."""
    token = d.new_id()
    processed = 0
    for _ in range(limit):
        session = sessions()
        try:
            row = claim_job(session, token)
            if row is None:
                session.rollback()
                return processed
            session.commit()
            identifier, kind = row.id, row.kind
            try:
                result_id = await run_job(session, row, settings)
                finish(session, row, result_id=result_id)
            except PlatformError as error:
                session.rollback()
                row = session.get(d.JobRow, identifier)
                finish(session, row, error=error)
                log.warning('job %s (%s) failed: %s', identifier, kind, error.code)
            except Exception:
                session.rollback()
                row = session.get(d.JobRow, identifier)
                finish(session, row, error=PlatformError('JOB_FAILED', 'This job could not be completed.', 500, True))
                log.exception('job %s (%s) raised', identifier, kind)
            session.commit()
            processed += 1
        finally:
            session.close()
    return processed


def drain_outbox(sessions: sessionmaker, consumer: str, handler, limit: int = 50) -> int:
    """At-least-once delivery per consumer.

    Progress belongs to the consumer's own receipt, so each subscriber advances, retries and
    dead-letters independently, and a replay of an already-processed event is a no-op.
    """
    session = sessions()
    delivered = 0
    try:
        now = d.utcnow()
        settled = select(d.ConsumerReceipt.event_id).where(
            d.ConsumerReceipt.consumer == consumer,
            d.ConsumerReceipt.status.in_(('processed', 'dead_letter')))
        due = select(d.ConsumerReceipt.event_id).where(
            d.ConsumerReceipt.consumer == consumer, d.ConsumerReceipt.status == 'pending',
            d.ConsumerReceipt.available_at > now)
        rows = list(session.scalars(
            select(d.OutboxRow)
            .where(d.OutboxRow.id.not_in(settled), d.OutboxRow.id.not_in(due),
                   d.OutboxRow.available_at <= now)
            .order_by(d.OutboxRow.created_at)
            .limit(limit)
            .with_for_update(skip_locked=True)))
        for row in rows:
            receipt = session.get(d.ConsumerReceipt, (row.id, consumer))
            if receipt is None:
                receipt = d.ConsumerReceipt(event_id=row.id, consumer=consumer, status='pending', attempts=0)
                session.add(receipt)
            receipt.attempts += 1
            try:
                handler(row)
            except Exception:
                receipt.available_at = now + backoff(receipt.attempts)
                if receipt.attempts >= MAX_ATTEMPTS:
                    receipt.status = 'dead_letter'
                log.exception('outbox %s delivery to %s failed', row.id, consumer)
                continue
            receipt.status = 'processed'
            receipt.processed_at = now
            delivered += 1
        session.commit()
    finally:
        session.close()
    return delivered


async def worker_loop(settings: Settings, interval: float = 5.0, iterations: int | None = None) -> None:
    engine = d.make_engine(settings)
    sessions = d.session_factory(engine)
    count = 0
    try:
        while iterations is None or count < iterations:
            processed = await drain_jobs(sessions, settings)
            delivered = sum(reminders.dispatch(sessions, settings).values())
            session = sessions()
            try:
                expired = science.expire_stale_tasks(session)
                session.commit()
            finally:
                session.close()
            if not processed and not delivered and not expired:
                await asyncio.sleep(interval)
            count += 1
    finally:
        engine.dispose()
