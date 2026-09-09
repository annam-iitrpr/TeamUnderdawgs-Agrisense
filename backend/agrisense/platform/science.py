"""Boundary to the Phase 2 facade. The platform never computes agronomy itself.

The facade is resolved lazily so this branch runs before that package merges: when it is
absent every dependent capability reports its dependency state instead of inventing a result.
"""
from __future__ import annotations

import hashlib
import json
import logging
from collections.abc import Callable
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from agrisense.contracts_generated import models as c
from agrisense.platform import db as d
from agrisense.platform.errors import PlatformError, unavailable

log = logging.getLogger('agrisense.platform.science')
FORECAST_HORIZON_DAYS = 10


def facade(name: str) -> Callable:
    try:
        from agrisense.science import facade as module
    except ImportError as exc:
        raise unavailable('Scientific evaluation') from exc
    entrypoint = getattr(module, name, None)
    if entrypoint is None:
        raise unavailable(f'Scientific entrypoint {name}')
    return entrypoint


def available() -> bool:
    try:
        facade('evaluate_season')
    except Exception:
        return False
    return True


def snapshot_hash(payload: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def build_season_snapshot(session: Session, tenant_id: str, season_id: str, as_of: datetime) -> c.SeasonSnapshot:
    """Immutable inputs for one evaluation. Everything the science reads is captured here."""
    season = session.scalar(select(d.SeasonRow).where(d.SeasonRow.id == season_id, d.SeasonRow.tenant_id == tenant_id))
    if season is None:
        raise unavailable('Season snapshot')
    field = session.scalar(select(d.FieldRow).where(d.FieldRow.id == season.field_id, d.FieldRow.tenant_id == tenant_id))
    farmer = session.scalar(select(d.FarmerRow).where(d.FarmerRow.id == field.farmer_id, d.FarmerRow.tenant_id == tenant_id))
    journal = list(session.scalars(select(d.JournalRow).where(d.JournalRow.season_id == season_id, d.JournalRow.tenant_id == tenant_id).order_by(d.JournalRow.occurred_at)))
    ledger = list(session.scalars(select(d.LedgerRow).where(d.LedgerRow.season_id == season_id, d.LedgerRow.tenant_id == tenant_id)))
    soil = list(session.scalars(select(d.SoilRow).where(d.SoilRow.field_id == season.field_id, d.SoilRow.tenant_id == tenant_id)))
    body = {
        'snapshot_id': d.new_id(), 'input_hash': 'pending', 'as_of': as_of,
        'farmer': farmer.payload, 'field': field.payload, 'season': season.payload,
        'soil_observations': [row.payload for row in soil],
        'journal': [row.payload for row in journal],
        'cost_ledger': [row.payload for row in ledger],
    }
    draft = c.SeasonSnapshot.model_validate(body)
    # The hash covers the inputs only, so an identical situation reuses a stored evaluation.
    identity = draft.model_dump(mode='json')
    identity.pop('snapshot_id')
    identity.pop('input_hash')
    identity.pop('as_of')
    return draft.model_copy(update={'input_hash': snapshot_hash(identity)})


async def weather_for(field_payload: dict[str, Any], as_of: datetime) -> c.ForecastBundle:
    location = c.Location.model_validate(field_payload['centroid'])
    build = facade('build_weather_bundle')
    return await build(location, FORECAST_HORIZON_DAYS, as_of)


def references() -> c.ReferenceBundle:
    """The reviewed catalog is Phase 2-owned; the platform must never invent coefficients.

    No builder is published yet, so the entrypoint is looked up by name and the capability
    reports its dependency state until one exists.
    """
    try:
        from agrisense.science import references as module
    except ImportError as exc:
        raise unavailable('Reviewed reference catalog') from exc
    for name in ('reference_bundle', 'reviewed_bundle', 'build_reference_bundle'):
        builder = getattr(module, name, None)
        if callable(builder):
            bundle = builder()
            return bundle if isinstance(bundle, c.ReferenceBundle) else c.ReferenceBundle.model_validate(bundle)
    raise unavailable('Reviewed reference catalog')


def translate(exc: Exception, capability: str) -> PlatformError:
    """A science-side failure is a dependency problem, not a platform bug.

    Reporting it as a generic failure would tell a farmer nothing and would hide which
    dependency was at fault, so the class name is carried in the details while the message
    stays something a farmer can act on.
    """
    if isinstance(exc, PlatformError):
        return exc
    log.exception('%s failed inside the science boundary', capability)
    error = unavailable(capability)
    error.details = {'dependency': type(exc).__name__}
    return error


async def evaluate(session: Session, tenant_id: str, season_id: str) -> tuple[c.EvaluationBundle, c.ForecastBundle, c.SeasonSnapshot]:
    """Run one evaluation. Reuses a stored result whenever the inputs are unchanged."""
    as_of = d.utcnow()
    snapshot = build_season_snapshot(session, tenant_id, season_id, as_of)
    try:
        forecast = await weather_for(snapshot.field.model_dump(mode='json'), as_of)
    except Exception as exc:
        raise translate(exc, 'Weather forecast') from exc
    try:
        bundle = facade('evaluate_season')(snapshot, forecast, references())
        if not isinstance(bundle, c.EvaluationBundle):
            bundle = c.EvaluationBundle.model_validate(bundle)
    except Exception as exc:
        raise translate(exc, 'Scientific evaluation') from exc
    return bundle, forecast, snapshot


def store_evaluation(session: Session, tenant_id: str, farmer_id: str, season: d.SeasonRow,
                     bundle: c.EvaluationBundle, snapshot: c.SeasonSnapshot,
                     forecast: c.ForecastBundle | None = None) -> d.RecommendationRow:
    """Persist an evaluation and retire the one it replaces, in the caller's transaction."""
    for previous in session.scalars(select(d.RecommendationRow).where(
            d.RecommendationRow.season_id == season.id, d.RecommendationRow.tenant_id == tenant_id,
            d.RecommendationRow.superseded.is_(False))):
        previous.superseded = True
        previous.payload = {**previous.payload, 'recommendation': {**previous.payload['recommendation'], 'superseded': True}}
    payload = bundle.model_dump(mode='json')
    row = d.RecommendationRow(
        id=bundle.recommendation.id, tenant_id=tenant_id, farmer_id=farmer_id, season_id=season.id,
        input_hash=snapshot.input_hash, input_version=season.version, superseded=False,
        payload=payload, snapshot={'snapshot': snapshot.model_dump(mode='json'),
                                   'forecast': forecast.model_dump(mode='json') if forecast else None})
    session.add(row)
    session.flush()
    for spec in bundle.proposed_tasks:
        persist_task(session, tenant_id, farmer_id, spec)
    return row


def persist_task(session: Session, tenant_id: str, farmer_id: str, spec: c.TaskSpec) -> d.TaskRow | None:
    """Science proposes tasks; only the platform stores them, and never twice."""
    existing = session.scalar(select(d.TaskRow).where(
        d.TaskRow.tenant_id == tenant_id, d.TaskRow.deduplication_key == spec.deduplication_key))
    if existing is not None:
        return None
    task = c.Task(**spec.model_dump(mode='json'), id=d.new_id(), status='pending', version=1)
    row = d.TaskRow(id=task.id, tenant_id=tenant_id, farmer_id=farmer_id, season_id=task.season_id,
                    status='pending', due_at=task.due.end_at, deduplication_key=task.deduplication_key,
                    version=1, payload=task.model_dump(mode='json'))
    session.add(row)
    return row


def expire_stale_tasks(session: Session, now: datetime | None = None) -> int:
    """A task whose window has passed is expired, never silently left pending."""
    now = now or d.utcnow()
    count = 0
    for row in session.scalars(select(d.TaskRow).where(d.TaskRow.status == 'pending', d.TaskRow.due_at < now)):
        row.status = 'expired'
        row.version += 1
        row.payload = {**row.payload, 'status': 'expired', 'version': row.version}
        count += 1
    return count
