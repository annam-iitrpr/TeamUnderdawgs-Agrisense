"""Reminder delivery.

A reminder is an intention; a notification is the thing a farmer actually sees. Delivery
respects quiet hours in the farmer's own timezone, and a reminder is never delivered twice.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from agrisense.config import Settings
from agrisense.contracts_generated import models as c
from agrisense.platform import db as d
from agrisense.platform import whatsapp

log = logging.getLogger('agrisense.platform.reminders')
CATCH_UP = timedelta(hours=6)


def next_allowed(moment: datetime, quiet: c.QuietHours) -> datetime:
    """Move a delivery out of quiet hours, to the moment they end, in the farmer's timezone."""
    zone = ZoneInfo(quiet.timezone)
    local = moment.astimezone(zone)
    start, end = quiet.start_hour, quiet.end_hour
    inside = (start <= local.hour or local.hour < end) if start > end else (start <= local.hour < end)
    if not inside:
        return moment
    release = local.replace(hour=end, minute=0, second=0, microsecond=0)
    if release <= local:
        release += timedelta(days=1)
    return release.astimezone(moment.tzinfo or release.tzinfo)


def due(session: Session, now: datetime, limit: int = 100) -> list[d.ReminderRow]:
    return list(session.scalars(
        select(d.ReminderRow)
        .where(d.ReminderRow.status.in_(('scheduled', 'queued')), d.ReminderRow.scheduled_at <= now)
        .order_by(d.ReminderRow.scheduled_at)
        .limit(limit)
        .with_for_update(skip_locked=True)))


def deliver(session: Session, settings: Settings, row: d.ReminderRow, now: datetime) -> str:
    reminder = c.Reminder.model_validate(row.payload)
    if not reminder.opted_in:
        row.status = 'cancelled'
        row.payload = {**row.payload, 'status': 'cancelled'}
        return 'not_opted_in'
    if reminder.task_id:
        task = session.get(d.TaskRow, reminder.task_id)
        if task is None or task.status in ('done', 'cancelled', 'expired'):
            # A reminder for work that is already settled is noise, not a nudge.
            row.status = 'cancelled'
            row.payload = {**row.payload, 'status': 'cancelled'}
            return 'task_settled'
    if d.aware(row.scheduled_at) < now - CATCH_UP:
        # Waking someone about a window that closed hours ago helps nobody.
        row.status = 'cancelled'
        row.payload = {**row.payload, 'status': 'cancelled'}
        return 'too_late'
    release = next_allowed(now, reminder.quiet_hours)
    if release > now:
        row.status = 'queued'
        row.scheduled_at = release
        row.payload = {**row.payload, 'status': 'queued', 'scheduled_at': release.isoformat()}
        return 'deferred'

    title = 'Field reminder'
    body = 'You asked to be reminded about this season.'
    notification = c.Notification(id=d.new_id(), season_id=reminder.season_id, task_id=reminder.task_id,
                                  title=title, body=body, created_at=now, delivery_state='pending', version=1)
    session.add(d.NotificationRow(id=notification.id, tenant_id=row.tenant_id, farmer_id=row.farmer_id,
                                  season_id=reminder.season_id, version=1,
                                  payload=notification.model_dump(mode='json')))
    state = 'sent'
    if reminder.channel == 'whatsapp':
        channel = session.scalar(select(d.ChannelRow).where(
            d.ChannelRow.tenant_id == row.tenant_id, d.ChannelRow.farmer_id == row.farmer_id,
            d.ChannelRow.provider == 'whatsapp'))
        if channel is None or not channel.opted_in:
            state = 'failed'
        else:
            whatsapp.queue_outbound(session, settings, channel, f'{title}: {body}')
    row.status = 'sent'
    row.payload = {**row.payload, 'status': 'sent'}
    stored = session.get(d.NotificationRow, notification.id)
    stored.payload = {**stored.payload, 'delivery_state': state}
    return state


def dispatch(sessions: sessionmaker, settings: Settings, now: datetime | None = None) -> dict[str, int]:
    """Deliver every due reminder once, reporting what happened to each."""
    now = now or d.utcnow()
    outcomes: dict[str, int] = {}
    session = sessions()
    try:
        for row in due(session, now):
            outcome = deliver(session, settings, row, now)
            row.version += 1
            row.payload = {**row.payload, 'version': row.version}
            outcomes[outcome] = outcomes.get(outcome, 0) + 1
        session.commit()
    except Exception:
        session.rollback()
        log.exception('reminder dispatch failed')
        raise
    finally:
        session.close()
    return outcomes
