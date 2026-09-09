"""Every HTTP endpoint. Each response carries a provenance block."""

from __future__ import annotations

import asyncio
import json
import uuid
from datetime import date as Date
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, File, UploadFile
from pydantic import BaseModel
from sqlmodel import Session, select

from agrisense.agronomy.constants import (
    CARDINALS,
    GDD_BASE_TEMPERATURE_C,
    INDIA_CROPS,
    PHOSPHORUS_SF_DIVISOR,
    YIELD_RISK_NORMALISE,
)
from agrisense.clients.base import Provenance
from agrisense.config import get_settings
from agrisense.models.db import get_session
from agrisense.models.tables import Farmer, FieldRecord, JournalEntry, Product, Recommendation
from agrisense.services.scoring_service import ScoringService

from .errors import NotFoundError

router = APIRouter()
service = ScoringService()


def _local_provenance(source: str, note: str | None = None) -> list[dict[str, Any]]:
    """Provenance for data that came from our own database rather than a provider."""
    return [Provenance(source, False, note=note).as_dict()]


@router.get("/health")
async def health() -> dict[str, Any]:
    return {"status": "ok", "service": "agrisense"}


@router.get("/api/config")
async def config() -> dict[str, Any]:
    settings = get_settings()
    sources = {
        "forecast": {
            "primary": "Syngenta CE Hub",
            "live": settings.should_try_live(settings.cehub_available),
            "substitute": "Open-Meteo",
        },
        "history": {
            "primary": "meteoblue Dataset API",
            "live": settings.should_try_live(settings.meteoblue_available),
            "substitute": None,
        },
        "explanations": {
            "primary": "Gemini" if settings.gemini_available else "Deterministic template",
            "live": settings.gemini_available,
            "substitute": "Deterministic template",
        },
    }
    any_live = any(s["live"] for s in sources.values())
    all_live = all(s["live"] for s in sources.values())
    data_mode = settings.agrisense_data_mode.value
    badge = "live" if all_live else ("mixed" if any_live else "demo")
    algorithm_flags = {
        "phosphorus_sf_divisor": PHOSPHORUS_SF_DIVISOR,
        "yield_risk_normalise": YIELD_RISK_NORMALISE,
    }
    build_sprint = [
        "WhatsApp Business API",
        "Vertex AI residual model",
        "Hierarchical zone calibration",
        "Voice note transcription",
        "Photo vision analysis",
        "Push notifications",
        "Real authentication",
        "BigQuery",
    ]
    return {
        "data_mode": data_mode,
        "badge": badge,
        "sources": sources,
        "algorithm_flags": algorithm_flags,
        "build_sprint": build_sprint,
        "provenance": _local_provenance("Local configuration"),
    }


class FarmerIn(BaseModel):
    name: str
    phone: str = ""
    preferred_language: str = "en"
    village: str = ""
    district: str = ""
    state: str = ""


class FieldIn(BaseModel):
    farmer_id: int
    name: str
    crop: str
    lat: float
    lon: float
    area_ha: float
    sowing_date: Date
    soil_ph: float = 6.5
    soil_ph_source: str = "assumed"


class FieldPatch(BaseModel):
    name: str | None = None
    crop: str | None = None
    area_ha: float | None = None
    sowing_date: Date | None = None
    soil_ph: float | None = None


@router.get("/api/farmers")
async def list_farmers(session: Session = Depends(get_session)) -> dict[str, Any]:
    farmers = session.exec(select(Farmer)).all()
    return {
        "items": [f.model_dump() for f in farmers],
        "provenance": _local_provenance("Seeded demo farmers"),
    }


@router.post("/api/farmers")
async def create_farmer(body: FarmerIn, session: Session = Depends(get_session)) -> dict[str, Any]:
    farmer = Farmer(**body.model_dump())
    session.add(farmer)
    session.commit()
    session.refresh(farmer)
    return {
        "item": farmer.model_dump(),
        "provenance": _local_provenance("Local database"),
    }


@router.get("/api/fields")
async def list_fields(
    farmer_id: int | None = None, session: Session = Depends(get_session)
) -> dict[str, Any]:
    statement = select(FieldRecord)
    if farmer_id is not None:
        statement = statement.where(FieldRecord.farmer_id == farmer_id)
    fields = session.exec(statement).all()
    return {
        "items": [f.model_dump() for f in fields],
        "provenance": _local_provenance("Seeded demo fields"),
    }


@router.post("/api/fields")
async def create_field(body: FieldIn, session: Session = Depends(get_session)) -> dict[str, Any]:
    if body.crop not in {c.value for c in INDIA_CROPS}:
        from .errors import AgriSenseError

        raise AgriSenseError(
            "crop_out_of_scope",
            f"crop {body.crop} is out of scope",
            user_message="This prototype covers rice, wheat and cotton, which are the crops in the Syngenta India product table.",
        )
    record = FieldRecord(**body.model_dump())
    session.add(record)
    session.commit()
    session.refresh(record)
    return {
        "item": record.model_dump(),
        "provenance": _local_provenance("Local database"),
    }


@router.get("/api/fields/{field_id}")
async def get_field(field_id: int, session: Session = Depends(get_session)) -> dict[str, Any]:
    record = session.get(FieldRecord, field_id)
    if record is None:
        raise NotFoundError("Field")
    return {
        "item": record.model_dump(),
        "provenance": _local_provenance("Local database"),
    }


@router.patch("/api/fields/{field_id}")
async def patch_field(
    field_id: int, body: FieldPatch, session: Session = Depends(get_session)
) -> dict[str, Any]:
    record = session.get(FieldRecord, field_id)
    if record is None:
        raise NotFoundError("Field")
    for key, value in body.model_dump(exclude_unset=True).items():
        setattr(record, key, value)
    session.add(record)
    session.commit()
    session.refresh(record)
    return {
        "item": record.model_dump(),
        "provenance": _local_provenance("Local database"),
    }


@router.post("/api/fields/{field_id}/score")
async def score_field(
    field_id: int, language: str = "en", session: Session = Depends(get_session)
) -> dict[str, Any]:
    record = session.get(FieldRecord, field_id)
    if record is None:
        raise NotFoundError("Field")
    result = await service.score_field(record, language)
    field_payload = record.model_dump(mode="json")
    recommendation = Recommendation(
        field_id=field_id,
        generated_at=datetime.now(),
        window_start=result.readiness.window.start if result.readiness.window else None,
        window_end=result.readiness.window.end if result.readiness.window else None,
        readiness_score=result.readiness.readiness_score,
        need=result.readiness.need,
        timing_fit=result.readiness.timing_fit,
        viability=result.readiness.viability,
        reason_text=result.reason_text,
        value_estimate_low=result.readiness.value_estimate.low_inr if result.readiness.value_estimate else 0,
        value_estimate_high=result.readiness.value_estimate.high_inr if result.readiness.value_estimate else 0,
        inputs_json=json.dumps(
            {
                "field": field_payload,
                "projection": result.projection.as_dict(),
                "candidates": result.candidates.as_dict(),
                "gdd_since_sowing": result.gdd_since_sowing,
            },
            default=str,
        ),
        provenance_json=json.dumps([p.as_dict() for p in result.provenance]),
        status="open" if result.readiness.actionable else "wait",
    )
    session.add(recommendation)
    session.commit()
    session.refresh(recommendation)
    return {
        **result.as_dict(),
        "recommendation_id": recommendation.id,
        "field": field_payload,
    }


@router.get("/api/fields/{field_id}/projection")
async def get_projection(field_id: int, session: Session = Depends(get_session)) -> dict[str, Any]:
    record = session.get(FieldRecord, field_id)
    if record is None:
        raise NotFoundError("Field")
    result = await service.score_field(record)
    return {
        **result.projection.as_dict(),
        "onset_threshold": 4.0,
        "provenance": [p.as_dict() for p in result.provenance],
    }


@router.get("/api/fields/{field_id}/hours")
async def get_hours(field_id: int, session: Session = Depends(get_session)) -> dict[str, Any]:
    record = session.get(FieldRecord, field_id)
    if record is None:
        raise NotFoundError("Field")
    result = await service.score_field(record)
    return {
        **result.ranked.as_dict(),
        "provenance": [p.as_dict() for p in result.provenance],
    }


class JournalIn(BaseModel):
    entry_type: str = "note"
    text: str = ""
    recommendation_id: int | None = None
    actual_spray_at: datetime | None = None
    outcome_rating: int | None = None


@router.get("/api/fields/{field_id}/journal")
async def list_journal(field_id: int, session: Session = Depends(get_session)) -> dict[str, Any]:
    entries = session.exec(select(JournalEntry).where(JournalEntry.field_id == field_id)).all()
    recommendations = session.exec(
        select(Recommendation).where(Recommendation.field_id == field_id)
    ).all()
    return {
        "items": [e.model_dump(mode="json") for e in sorted(entries, key=lambda e: e.logged_at)],
        "recommendations": [
            r.model_dump(mode="json", exclude={"inputs_json", "provenance_json"})
            for r in recommendations
        ],
        "provenance": _local_provenance("Local database"),
    }


@router.post("/api/fields/{field_id}/journal")
async def create_journal(
    field_id: int, body: JournalIn, session: Session = Depends(get_session)
) -> dict[str, Any]:
    if session.get(FieldRecord, field_id) is None:
        raise NotFoundError("Field")
    entry = JournalEntry(field_id=field_id, **body.model_dump())
    session.add(entry)
    session.commit()
    session.refresh(entry)
    return {
        "item": entry.model_dump(mode="json"),
        "provenance": _local_provenance("Local database"),
    }


@router.post("/api/journal/{entry_id}/photo")
async def upload_photo(
    entry_id: int, file: UploadFile = File(...), session: Session = Depends(get_session)
) -> dict[str, Any]:
    entry = session.get(JournalEntry, entry_id)
    if entry is None:
        raise NotFoundError("Journal entry")
    settings = get_settings()
    suffix = (file.filename or "photo.jpg").split(".")[-1][:8]
    name = f"{uuid.uuid4().hex}.{suffix}"
    destination = settings.uploads_dir / name
    destination.write_bytes(await file.read())
    entry.photo_path = f"/uploads/{name}"
    session.add(entry)
    session.commit()
    session.refresh(entry)
    return {
        "item": entry.model_dump(mode="json"),
        "provenance": _local_provenance("Local upload directory"),
    }


@router.get("/api/dashboard/summary")
async def dashboard_summary(session: Session = Depends(get_session)) -> dict[str, Any]:
    fields = session.exec(select(FieldRecord)).all()
    farmers = {f.id: f for f in session.exec(select(Farmer)).all()}
    entries = session.exec(select(JournalEntry)).all()
    rows = []
    provenance = []
    open_windows = 0
    results = await asyncio.gather(*(service.score_field(r) for r in fields))
    for record, result in zip(fields, results, strict=True):
        if not provenance:
            provenance = [p.as_dict() for p in result.provenance]
        if result.readiness.actionable:
            open_windows += 1
        field_entries = [e for e in entries if e.field_id == record.id]
        followed = sum(1 for e in field_entries if e.actual_spray_at is not None)
        farmer = farmers.get(record.farmer_id)
        rows.append(
            {
                "field_id": record.id,
                "field_name": record.name,
                "farmer_name": farmer.name if farmer else "Unknown",
                "village": farmer.village if farmer else "",
                "crop": record.crop,
                "lat": record.lat,
                "lon": record.lon,
                "area_ha": record.area_ha,
                "readiness_score": result.readiness.readiness_score,
                "need": result.readiness.need,
                "driving_stress": result.readiness.driving_stress,
                "stress_level": round((result.readiness.need or 0) * 9, 1),
                "window_start": result.readiness.window.start.isoformat() if result.readiness.window else None,
                "window_end": result.readiness.window.end.isoformat() if result.readiness.window else None,
                "actionable": result.readiness.actionable,
                "blocked_reason": result.readiness.blocked_reason,
                "journal_entries": len(field_entries),
                "sprays_logged": followed,
            }
        )
    total_entries = len(entries)
    sprays = sum(1 for e in entries if e.actual_spray_at is not None)
    recommendations = session.exec(select(Recommendation)).all()
    adherence = round(100 * sprays / len(recommendations), 1) if recommendations else 0
    stats = {
        "fields_monitored": len(fields),
        "open_windows": open_windows,
        "adherence_rate": adherence,
        "journal_entries": total_entries,
    }
    return {
        "stats": stats,
        "rows": rows,
        "provenance": provenance or _local_provenance("Local database"),
    }


@router.get("/api/dashboard/stress-map")
async def stress_map(session: Session = Depends(get_session)) -> dict[str, Any]:
    fields = session.exec(select(FieldRecord)).all()
    points = []
    provenance = []
    results = await asyncio.gather(*(service.score_field(r) for r in fields))
    for record, result in zip(fields, results, strict=True):
        if not provenance:
            provenance = [p.as_dict() for p in result.provenance]
        points.append(
            {
                "field_id": record.id,
                "name": record.name,
                "lat": record.lat,
                "lon": record.lon,
                "crop": record.crop,
                "stress_level": round((result.readiness.need or 0) * 9, 1),
                "readiness_score": result.readiness.readiness_score,
                "actionable": result.readiness.actionable,
            }
        )
    return {
        "points": points,
        "provenance": provenance or _local_provenance("Local database"),
    }


class BacktestIn(BaseModel):
    field_id: int
    season_start: Date
    season_end: Date


@router.post("/api/backtest")
async def backtest(body: BacktestIn, session: Session = Depends(get_session)) -> dict[str, Any]:
    record = session.get(FieldRecord, body.field_id)
    if record is None:
        raise NotFoundError("Field")
    return await service.backtest(record, body.season_start, body.season_end)


@router.get("/api/products")
async def list_products(session: Session = Depends(get_session)) -> dict[str, Any]:
    products = session.exec(select(Product)).all()
    return {
        "items": [p.model_dump() for p in products],
        "provenance": _local_provenance(
            "Syngenta India product table, algorithm_logic.pdf page 1"
        ),
    }


@router.get("/api/algorithm/constants")
async def algorithm_constants() -> dict[str, Any]:
    cardinals = {
        crop.value: {
            "tmax_optimum": c.tmax_optimum,
            "tmax_limit": c.tmax_limit,
            "tmin_optimum": c.tmin_optimum,
            "tmin_limit": c.tmin_limit,
            "tmin_no_frost": c.tmin_no_frost,
            "tmin_frost": c.tmin_frost,
            "in_india_scope": crop in INDIA_CROPS,
        }
        for crop, c in CARDINALS.items()
    }
    gdd_base = {c.value: v for c, v in GDD_BASE_TEMPERATURE_C.items()}
    return {
        "cardinals": cardinals,
        "gdd_base": gdd_base,
        "provenance": _local_provenance(
            "docs/algorithm_logic.pdf", "Cardinal temperatures from pages 2 and 3."
        ),
    }
