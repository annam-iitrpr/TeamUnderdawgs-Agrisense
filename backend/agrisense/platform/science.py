"""Boundary to the Phase 2 facade. The platform never computes agronomy itself.

The facade is resolved lazily so this branch runs before that package merges: when it is
absent every dependent capability reports its dependency state instead of inventing a result.
"""
from __future__ import annotations

import hashlib
import json
import logging
from collections.abc import Callable
from datetime import date, datetime
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


def summarise(session: Session, tenant_id: str, season_id: str,
              closure: c.SeasonClosure) -> c.SeasonEvaluation:
    """Score a closed season against the forecasts that were on record while it ran.

    The platform owns the records and Phase 2 owns the arithmetic, so this builds
    the ClosureSnapshot and hands it over rather than computing margins here. The
    science recomputes the margin from the stored sales and costs and never trusts
    a supplied one, because a revision to realized costs must not leave a stale
    margin standing.

    Only recommendations belonging to this season are included: `summarize_season`
    rejects a foreign one outright, and it is right to.
    """
    snapshot = build_season_snapshot(session, tenant_id, season_id, closure.confirmed_at)
    rows = session.scalars(
        select(d.RecommendationRow).where(
            d.RecommendationRow.season_id == season_id,
            d.RecommendationRow.tenant_id == tenant_id,
        )
    )
    draft = c.ClosureSnapshot.model_validate({
        'season': snapshot.model_dump(mode='json'),
        'closure': closure.model_dump(mode='json'),
        'recommendations': [row.payload for row in rows],
    })
    summarize = facade('summarize_season')
    return summarize(draft)


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


async def climate_for(location: c.Location, period: c.DateInterval, as_of: datetime, settings) -> c.ClimateBundle:
    """Historical reanalysis for the planning window, taken from past years.

    A ten-day forecast is not a season's climate. Phase 2 is explicit that reanalysis must
    never be presented as a forecast, so the bundle is labelled estimated and its provenance
    names the source.
    """
    try:
        from agrisense.science.contract_bridge import measurement
        from agrisense.science.history import MeteoblueHistoryProvider
        from agrisense.science.providers import JsonTransport
    except ImportError as exc:
        raise unavailable('Historical climate') from exc
    if not settings.meteoblue_api_key:
        raise unavailable('Historical climate')

    # The same calendar window in the previous complete year, which is available reanalysis.
    start = period.start_date.replace(year=period.start_date.year - 1)
    end = period.end_date.replace(year=period.end_date.year - 1)
    provider = MeteoblueHistoryProvider(JsonTransport(), api_key=settings.meteoblue_api_key)
    try:
        bundle = await provider.history((location.latitude, location.longitude), start, end, as_of)
    except Exception as exc:
        raise translate(exc, 'Historical climate') from exc

    days = [c.ForecastDay(local_date=date.fromisoformat(row.date),
                          minimum_temperature_c=measurement(row.tmin_c, '°C'),
                          maximum_temperature_c=measurement(row.tmax_c, '°C'),
                          rain_mm=measurement(row.rain_mm, 'mm'),
                          et0_mm=measurement(row.et0_mm, 'mm'))
            for row in bundle.daily]
    return c.ClimateBundle(
        location=location, period=c.DateInterval(start_date=start, end_date=end), daily=days,
        provenance=[c.Provenance(source=bundle.provider, retrieved_at=as_of, data_mode='estimated',
                                 note='Historical reanalysis for the same window last year, not a forecast.')],
        data_mode='estimated', warnings=list(bundle.warnings))


async def compare(session: Session, tenant_id: str, farmer_id: str, request: c.PlanningRequest,
                  settings) -> c.CropComparison:
    """Plan against reviewed references and past climate. Nothing here is a forecast."""
    as_of = d.utcnow()
    field = session.scalar(select(d.FieldRow).where(
        d.FieldRow.id == request.field_id, d.FieldRow.tenant_id == tenant_id,
        d.FieldRow.farmer_id == farmer_id))
    if field is None:
        raise unavailable('Field snapshot')
    seasons = list(session.scalars(select(d.SeasonRow).where(
        d.SeasonRow.field_id == field.id, d.SeasonRow.tenant_id == tenant_id,
        d.SeasonRow.status != 'closed')))
    soil = list(session.scalars(select(d.SoilRow).where(
        d.SoilRow.field_id == field.id, d.SoilRow.tenant_id == tenant_id)))
    snapshot = c.PlanningSnapshot.model_validate({
        'as_of': as_of, 'field': field.payload, 'request': request.model_dump(mode='json'),
        'existing_seasons': [row.payload for row in seasons],
        'soil_observations': [row.payload for row in soil]})
    climate = await climate_for(snapshot.field.centroid, request.proposed_season, as_of, settings)
    try:
        result = facade('compare_crops')(snapshot, references(), climate)
    except Exception as exc:
        raise translate(exc, 'Crop planning') from exc
    return result if isinstance(result, c.CropComparison) else c.CropComparison.model_validate(result)


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
