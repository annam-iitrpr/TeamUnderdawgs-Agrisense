"""SQLModel tables.

Recommendation.inputs_json stores every input that produced a score, so any
recommendation can be reconstructed months later. That is the audit trail.
"""

from __future__ import annotations

import json
from datetime import date as Date
from datetime import datetime
from typing import Any

from sqlmodel import Field, SQLModel


class Farmer(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str
    phone: str = ""
    preferred_language: str = "en"
    village: str = ""
    district: str = ""
    state: str = ""


class FieldRecord(SQLModel, table=True):
    __tablename__ = "field"

    id: int | None = Field(default=None, primary_key=True)
    farmer_id: int = Field(foreign_key="farmer.id", index=True)
    name: str
    crop: str
    lat: float
    lon: float
    area_ha: float
    sowing_date: Date
    soil_ph: float = 6.5
    soil_ph_source: str = "assumed"
    soil_moisture_pct: float = 55.0
    nitrogen_g_per_kg: float = 0.06


class Product(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str
    kind: str
    crops: str
    stages: str
    price_per_litre: float


class Recommendation(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    field_id: int = Field(foreign_key="field.id", index=True)
    product_id: int | None = Field(default=None, foreign_key="product.id")
    generated_at: datetime = Field(default_factory=datetime.now)
    window_start: datetime | None = None
    window_end: datetime | None = None
    readiness_score: int = 0
    need: float = 0.0
    timing_fit: float = 0.0
    viability: float = 0.0
    reason_text: str = ""
    value_estimate_low: int = 0
    value_estimate_high: int = 0
    inputs_json: str = "{}"
    provenance_json: str = "{}"
    status: str = "open"

    @property
    def inputs(self) -> dict[str, Any]:
        try:
            return dict(json.loads(self.inputs_json))
        except json.JSONDecodeError:
            return {}

    @property
    def provenance(self) -> dict[str, Any]:
        try:
            return dict(json.loads(self.provenance_json))
        except json.JSONDecodeError:
            return {}


class JournalEntry(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    field_id: int = Field(foreign_key="field.id", index=True)
    recommendation_id: int | None = Field(default=None, foreign_key="recommendation.id")
    logged_at: datetime = Field(default_factory=datetime.now)
    actual_spray_at: datetime | None = None
    entry_type: str = "note"
    text: str = ""
    photo_path: str | None = None
    outcome_rating: int | None = None
    weather_at_spray_json: str = "{}"


class StressReading(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    field_id: int = Field(foreign_key="field.id", index=True)
    date: Date
    stress_type: str
    value: float
    is_projection: bool = True
    source: str = "fixture"
