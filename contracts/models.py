"""Authoring models for contract_v1. Run scripts/generate_contracts.py after edits.

All examples are synthetic. Platform owns persistence; science owns computations.
"""
from __future__ import annotations

from datetime import date
from typing import Annotated, Generic, Literal, TypeVar

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field as PydanticField, model_validator

Id = Annotated[str, PydanticField(min_length=1, max_length=128)]
Version = Annotated[int, PydanticField(ge=1)]
Fraction = Annotated[float, PydanticField(ge=0, le=1)]
Positive = Annotated[float, PydanticField(gt=0)]
Nonnegative = Annotated[float, PydanticField(ge=0)]
Language = Literal['en', 'hi', 'mr', 'pa', 'te']
DataMode = Literal['live', 'estimated', 'demo', 'mixed', 'unavailable']
JsonScalar = str | float | bool | None


class ContractModel(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)


class Provenance(ContractModel):
    source: str
    retrieved_at: AwareDatetime | None = None
    evidence_id: str | None = None
    data_mode: DataMode
    note: str | None = None


class Meta(ContractModel):
    request_id: str
    schema_version: Literal['1.0'] = '1.0'
    data_mode: DataMode
    generated_at: AwareDatetime
    provenance: list[Provenance] = []
    warnings: list[str] = []
    job_id: Id | None = None


T = TypeVar('T')
class Envelope(ContractModel, Generic[T]):
    data: T
    meta: Meta


class Page(ContractModel, Generic[T]):
    items: list[T]
    next_cursor: str | None = None


class ErrorDetail(ContractModel):
    code: str
    message: str
    details: dict[str, JsonScalar] = {}
    retryable: bool = False


class ErrorResponse(ContractModel):
    error: ErrorDetail
    request_id: str


class VersionedPatch(ContractModel):
    expected_version: Version


class Interval(ContractModel):
    start_at: AwareDatetime
    end_at: AwareDatetime

    @model_validator(mode='after')
    def ordered(self):
        if self.end_at <= self.start_at:
            raise ValueError('end_at must be after start_at; interval is half-open')
        return self


class DateInterval(ContractModel):
    start_date: date
    end_date: date

    @model_validator(mode='after')
    def ordered(self):
        if self.end_date < self.start_date:
            raise ValueError('end_date must not precede start_date')
        return self


class Consent(ContractModel):
    purpose: Literal['terms', 'privacy', 'whatsapp', 'push', 'analytics', 'training']
    version: str
    granted: bool
    recorded_at: AwareDatetime


class Farmer(ContractModel):
    id: Id
    tenant_id: Id
    display_name: str
    preferred_language: Language = 'en'
    timezone: Literal['Asia/Kolkata'] = 'Asia/Kolkata'
    consents: list[Consent] = []
    linked_channel_ids: list[Id] = []
    version: Version


class ProfilePatch(VersionedPatch):
    display_name: str | None = None
    preferred_language: Language | None = None
    consents: list[Consent] | None = None


class Location(ContractModel):
    latitude: Annotated[float, PydanticField(ge=-90, le=90)]
    longitude: Annotated[float, PydanticField(ge=-180, le=180)]
    precision_m: Positive | None = None
    source: Literal['gps', 'map', 'manual', 'village']


class Polygon(ContractModel):
    type: Literal['Polygon'] = 'Polygon'
    coordinates: list[list[tuple[float, float]]]

    @model_validator(mode='after')
    def valid_rings(self):
        if not self.coordinates:
            raise ValueError('polygon must contain a ring')
        for ring in self.coordinates:
            if len(ring) < 4 or ring[0] != ring[-1]:
                raise ValueError('polygon rings must be closed with at least four positions')
            if any(not (-180 <= lon <= 180 and -90 <= lat <= 90) for lon, lat in ring):
                raise ValueError('invalid GeoJSON coordinate')
        return self


class Measurement(ContractModel):
    value: float | None
    unit: str
    analyte: str | None = None
    method: str | None = None
    missing_reason: str | None = None
    provenance: list[Provenance] = []

    @model_validator(mode='after')
    def missing_explained(self):
        if self.value is None and not self.missing_reason:
            raise ValueError('unknown measurement requires missing_reason')
        return self


class SoilObservation(ContractModel):
    id: Id
    field_id: Id
    sampled_on: date | None = None
    depth_cm: Nonnegative | None = None
    ph: Measurement | None = None
    organic_carbon: Measurement | None = None
    organic_matter: Measurement | None = None
    nitrogen: Measurement | None = None
    phosphorus: Measurement | None = None
    potassium: Measurement | None = None
    micronutrients: dict[str, Measurement] = {}
    texture: str | None = None
    bulk_density: Measurement | None = None
    moisture: Measurement | None = None
    moisture_basis: Literal['volumetric', 'gravimetric', 'percent_field_capacity'] | None = None
    source: Literal['lab', 'farmer', 'gridded_estimate']
    confirmation_state: Literal['draft', 'confirmed', 'rejected']
    attachment_id: Id | None = None
    original_ocr: str | None = None
    version: Version


class FieldCreate(ContractModel):
    name: Annotated[str, PydanticField(min_length=1, max_length=160)]
    area_ha: Positive
    entered_area: Positive
    entered_area_unit: Literal['ha', 'acre', 'sqm', 'kanal']
    centroid: Location
    polygon: Polygon | None = None
    irrigation_method: str | None = None
    available_water_m3: Nonnegative | None = None
    water_budget_inr: Nonnegative | None = None


class Field(FieldCreate):
    id: Id
    farmer_id: Id
    soil_summary: SoilObservation | None = None
    archived: bool = False
    version: Version


class FieldPatch(VersionedPatch):
    name: Annotated[str, PydanticField(min_length=1, max_length=160)] | None = None
    area_ha: Positive | None = None
    entered_area: Positive | None = None
    entered_area_unit: Literal['ha', 'acre', 'sqm', 'kanal'] | None = None
    centroid: Location | None = None
    polygon: Polygon | None = None
    irrigation_method: str | None = None
    available_water_m3: Nonnegative | None = None
    water_budget_inr: Nonnegative | None = None


class SeasonCreate(ContractModel):
    crop_id: Id
    variety: str | None = None
    sowing_date: date | None = None
    transplanting_date: date | None = None
    date_confidence: Literal['confirmed', 'estimated', 'unknown'] = 'unknown'
    allocated_area_ha: Positive
    stage: str | None = None
    stage_source: Literal['farmer', 'observed', 'model', 'unknown'] = 'unknown'
    status: Literal['planned', 'active'] = 'planned'
    intercropping_group_id: Id | None = None


class Season(ContractModel):
    id: Id
    field_id: Id
    crop_id: Id
    variety: str | None = None
    sowing_date: date | None = None
    transplanting_date: date | None = None
    date_confidence: Literal['confirmed', 'estimated', 'unknown']
    allocated_area_ha: Positive
    stage: str | None = None
    stage_source: Literal['farmer', 'observed', 'model', 'unknown']
    status: Literal['planned', 'active', 'closed']
    intercropping_group_id: Id | None = None
    version: Version


class SeasonPatch(VersionedPatch):
    variety: str | None = None
    sowing_date: date | None = None
    transplanting_date: date | None = None
    date_confidence: Literal['confirmed', 'estimated', 'unknown'] | None = None
    allocated_area_ha: Positive | None = None
    stage: str | None = None
    stage_source: Literal['farmer', 'observed', 'model', 'unknown'] | None = None
    status: Literal['planned', 'active'] | None = None


class Estimate(ContractModel):
    p10: float | None
    p50: float | None
    p90: float | None
    unit: str
    basis: Literal['scenario', 'empirically_calibrated', 'observed']
    assumptions: list[str] = []
    evidence_ids: list[str] = []
    target: str
    horizon: DateInterval | None = None
    input_completeness: Fraction
    calibration_sample_size: int | None = None
    empirical_coverage: Fraction | None = None
    missing_reason: str | None = None

    @model_validator(mode='after')
    def quantiles(self):
        vals = [v for v in (self.p10, self.p50, self.p90) if v is not None]
        if vals != sorted(vals):
            raise ValueError('quantiles must not cross')
        if not vals and not self.missing_reason:
            raise ValueError('unknown estimate requires missing_reason')
        return self


class ForecastHour(ContractModel):
    interval: Interval
    temperature_c: Measurement
    relative_humidity_pct: Measurement
    wind_kmh: Measurement
    wind_height_m: Positive | None = None
    rain_mm: Measurement
    vpd_kpa: Measurement
    radiation_w_m2: Measurement | None = None
    radiation_wh_m2: Measurement | None = None


class ForecastDay(ContractModel):
    local_date: date
    minimum_temperature_c: Measurement
    maximum_temperature_c: Measurement
    rain_mm: Measurement
    et0_mm: Measurement


class ForecastBundle(ContractModel):
    provider: str
    grid_location: Location
    grid_resolution_km: Positive | None = None
    retrieved_at: AwareDatetime
    issued_at: AwareDatetime | None = None
    coverage: Interval
    hourly: list[ForecastHour] = []
    daily: list[ForecastDay] = []
    raw_payload_hash: str
    bias_model_version: str | None = None
    data_mode: DataMode
    provenance: list[Provenance] = []
    warnings: list[str] = []


class Reason(ContractModel):
    code: str
    facts: dict[str, JsonScalar] = {}
    evidence_ids: list[str] = []


class SafetyCheck(ContractModel):
    code: str
    status: Literal['passed', 'failed', 'unknown', 'not_applicable']
    reason: Reason


class StressPoint(ContractModel):
    local_date: date
    stress_type: str
    value: Fraction | None
    missing_reason: str | None = None


class StressOnset(ContractModel):
    stress_type: str
    local_date: date | None
    threshold: float | None
    reason: str | None = None


class ProductFit(ContractModel):
    product_id: Id
    eligible: bool
    reasons: list[Reason]
    label_evidence_ids: list[str] = []


class Recommendation(ContractModel):
    id: Id
    field_id: Id
    season_id: Id
    input_version: Version
    input_hash: str
    generated_at: AwareDatetime
    expires_at: AwareDatetime
    product_id: Id | None = None
    rule_version: str
    model_version: str | None = None
    evidence_versions: list[str] = []
    status: Literal['recommended', 'monitor', 'blocked', 'insufficient_data', 'out_of_scope']
    readiness: Annotated[float, PydanticField(ge=0, le=100)] | None
    need: Fraction | None
    timing_fit: Fraction | None
    viability: Fraction | None
    stage: str | None = None
    stress_curve: list[StressPoint] = []
    stress_onsets: list[StressOnset] = []
    selected_window: Interval | None
    alternative_windows: list[Interval] = []
    reasons: list[Reason]
    product_fit: ProductFit | None = None
    safety_checks: list[SafetyCheck] = []
    forecast_provenance: list[Provenance] = []
    incremental_value: Estimate | None = None
    superseded: bool = False


class WaterEstimate(ContractModel):
    seasonal: Estimate
    daily: list[Measurement] = []
    assumptions: list[str] = []
    irrigation_needed: bool | None = None
    missing_reason: str | None = None


class Economics(ContractModel):
    cost: Estimate
    revenue: Estimate
    profit: Estimate
    roi: Estimate
    price: Measurement
    price_date: date | None = None
    price_source: str | None = None


class CropPlan(ContractModel):
    crop_id: Id
    sowing_interval: DateInterval | None
    harvest_interval: DateInterval | None
    compatibility: dict[str, Fraction | None] = {}
    exclusions: list[Reason] = []
    water: WaterEstimate | None = None
    economics: Economics | None = None
    suitability_evidence_ids: list[str] = []
    within_crop_baseline: str | None = None


class PlanningRequest(ContractModel):
    field_id: Id
    proposed_season: DateInterval
    candidate_crop_ids: Annotated[list[Id], PydanticField(min_length=1, max_length=5)]
    available_water_m3: Nonnegative | None = None
    budget_inr: Nonnegative | None = None


class CropComparison(ContractModel):
    candidates: list[CropPlan]
    exclusions: list[Reason] = []
    data_mode: DataMode
    warnings: list[str] = []


Action = Literal['watered', 'fertilizer_applied', 'biostimulant_applied', 'pesticide_applied', 'weed_removed', 'observation', 'harvest']
class JournalCreate(ContractModel):
    action: Action
    occurred_at: AwareDatetime
    quantities: list[Measurement] = []
    cost_inr: Nonnegative | None = None
    text: Annotated[str, PydanticField(max_length=8000)] = ''
    media_ids: list[Id] = []
    recommendation_id: Id | None = None


class JournalEntry(JournalCreate):
    id: Id
    season_id: Id
    entered_by: Id
    source: Literal['web', 'whatsapp', 'agronomist']
    received_at: AwareDatetime
    observation_quality: Literal['unreviewed', 'confirmed', 'rejected']
    version: Version


class JournalPatch(VersionedPatch):
    occurred_at: AwareDatetime | None = None
    quantities: list[Measurement] | None = None
    cost_inr: Nonnegative | None = None
    text: str | None = None


class TaskSpec(ContractModel):
    season_id: Id
    source_recommendation_id: Id | None = None
    due: Interval
    priority: Literal['low', 'normal', 'high', 'critical']
    reason: Reason
    title: str
    deduplication_key: str


class Task(TaskSpec):
    id: Id
    status: Literal['pending', 'done', 'snoozed', 'cancelled', 'expired']
    version: Version


class TaskPatch(VersionedPatch):
    status: Literal['pending', 'done', 'snoozed', 'cancelled']
    snoozed_until: AwareDatetime | None = None
    confirmed_action: JournalCreate | None = None


class Notification(ContractModel):
    id: Id
    season_id: Id | None = None
    task_id: Id | None = None
    title: str
    body: str
    created_at: AwareDatetime
    delivery_state: Literal['pending', 'sent', 'delivered', 'failed', 'cancelled']
    read_at: AwareDatetime | None = None
    acknowledged_at: AwareDatetime | None = None
    version: Version


class NotificationPatch(VersionedPatch):
    read: bool = False
    acknowledged: bool = False


class QuietHours(ContractModel):
    start_hour: Annotated[int, PydanticField(ge=0, le=23)] = 21
    end_hour: Annotated[int, PydanticField(ge=0, le=23)] = 7
    timezone: Literal['Asia/Kolkata'] = 'Asia/Kolkata'


class ReminderCreate(ContractModel):
    season_id: Id
    task_id: Id | None = None
    scheduled_at: AwareDatetime
    channel: Literal['in_app', 'whatsapp', 'push']
    opted_in: bool
    quiet_hours: QuietHours = QuietHours()


class Reminder(ReminderCreate):
    id: Id
    status: Literal['scheduled', 'queued', 'sent', 'cancelled', 'failed']
    version: Version


class ReminderPatch(VersionedPatch):
    scheduled_at: AwareDatetime | None = None
    opted_in: bool | None = None
    status: Literal['scheduled', 'cancelled'] | None = None


class SeasonCloseRequest(VersionedPatch):
    harvest_quantity_kg: Nonnegative
    product_form: str
    moisture_basis: str
    harvested_area_ha: Positive
    realized_sales_inr: Nonnegative
    realized_costs_inr: Nonnegative
    harvested_on: date


class SeasonClosure(SeasonCloseRequest):
    id: Id
    season_id: Id
    actual_margin_inr: float
    forecast_snapshot_ids: list[Id] = []
    confirmed_at: AwareDatetime
    version: Version


class ErrorMetric(ContractModel):
    name: str
    value: float | None
    unit: str
    denominator_policy: str
    missing_reason: str | None = None


class SeasonEvaluation(ContractModel):
    season_id: Id
    closure: SeasonClosure | None = None
    metrics: list[ErrorMetric] = []
    warnings: list[str] = []


class UploadRequest(ContractModel):
    filename: Annotated[str, PydanticField(min_length=1, max_length=255)]
    content_type: Literal['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'audio/ogg', 'audio/mpeg', 'audio/wav']
    size_bytes: Annotated[int, PydanticField(gt=0, le=20971520)]
    captured_at: AwareDatetime | None = None


class MediaAsset(ContractModel):
    id: Id
    content_type: str
    size_bytes: int
    status: Literal['pending', 'uploaded', 'processing', 'ready', 'rejected']
    captured_at: AwareDatetime | None = None
    received_at: AwareDatetime
    version: Version


class UploadTicket(ContractModel):
    asset: MediaAsset
    upload_url: str
    method: Literal['PUT'] = 'PUT'
    expires_at: AwareDatetime
    headers: dict[str, str] = {}


class MediaComplete(ContractModel):
    sha256: Annotated[str, PydanticField(pattern='^[a-f0-9]{64}$')]


class MediaAccess(ContractModel):
    url: str
    expires_at: AwareDatetime


class SoilExtractionRequest(ContractModel):
    field_id: Id
    media_id: Id


class SoilConfirmRequest(VersionedPatch):
    observation: SoilObservation


class ConversationCreate(ContractModel):
    field_id: Id | None = None
    season_id: Id | None = None
    language: Language = 'en'


class Conversation(ConversationCreate):
    id: Id
    created_at: AwareDatetime
    version: Version


class MessageCreate(ContractModel):
    text: Annotated[str, PydanticField(max_length=8000)] = ''
    media_ids: Annotated[list[Id], PydanticField(max_length=5)] = []


class Message(MessageCreate):
    id: Id
    conversation_id: Id
    role: Literal['user', 'assistant']
    created_at: AwareDatetime
    proposal_ids: list[Id] = []
    source_record_ids: list[Id] = []


class ProposedMutation(ContractModel):
    id: Id
    conversation_id: Id
    message_id: Id
    operation: Literal['journal.create', 'field.update', 'task.update', 'season.close']
    target_id: Id
    expected_version: Version
    old_values: dict[str, JsonScalar]
    new_values: JournalCreate | FieldPatch | TaskPatch | SeasonCloseRequest
    expires_at: AwareDatetime
    status: Literal['pending', 'confirmed', 'cancelled', 'expired']
    version: Version


class MutationReceipt(ContractModel):
    id: Id
    status: Literal['accepted', 'completed', 'cancelled']
    resource_id: Id | None = None
    version: Version | None = None


class ChannelLinkRequest(ContractModel):
    consent_version: str


class ChannelLinkChallenge(ContractModel):
    challenge_id: Id
    code: str
    expires_at: AwareDatetime
    instructions: str


class PushRegistration(ContractModel):
    token: Annotated[str, PydanticField(min_length=1, max_length=4096)]
    consent_version: str


class PushUnregister(ContractModel):
    token: Annotated[str, PydanticField(min_length=1, max_length=4096)]


class Crop(ContractModel):
    id: Id
    name: str
    supported_for_biological_advice: bool
    evidence_ids: list[str] = []


class Product(ContractModel):
    id: Id
    name: str
    crop_ids: list[Id]
    label_version: str
    evidence_ids: list[str]


class LocationResult(ContractModel):
    id: Id
    name: str
    district: str | None = None
    state: str
    centroid: Location


class EvaluateRequest(ContractModel):
    expected_version: Version
    force_refresh: bool = False


class Job(ContractModel):
    id: Id
    kind: str
    status: Literal['pending', 'running', 'succeeded', 'failed', 'dead_letter', 'cancelled']
    created_at: AwareDatetime
    updated_at: AwareDatetime
    result_id: Id | None = None
    error: ErrorDetail | None = None
    attempts: int = 0


class ModelVersion(ContractModel):
    id: Id
    target: str
    status: Literal['candidate', 'shadow', 'approved', 'retired']
    artifact_hash: str
    evidence_ids: list[str]
    metrics: list[ErrorMetric]
    approved_at: AwareDatetime | None = None
    approved_by: Id | None = None


class AgronomistSummary(ContractModel):
    assigned_farmer_count: int
    field_count: int
    active_season_count: int
    recommendation_status_counts: dict[str, int]


class StressMapPoint(ContractModel):
    field_id: Id
    centroid: Location
    stress: Fraction | None
    missing_reason: str | None = None


class EvidenceRecord(ContractModel):
    id: Id
    kind: str
    title: str
    source: str
    sample_count: int | None = None
    limitations: list[str]


class BacktestRequest(ContractModel):
    dataset_id: Id
    model_version_id: Id
    date_range: DateInterval


class LedgerLine(ContractModel):
    id: Id
    season_id: Id
    journal_entry_id: Id | None = None
    kind: Literal['cost', 'revenue', 'irrigation']
    amount: Nonnegative
    unit: str
    occurred_at: AwareDatetime


class SeasonSnapshot(ContractModel):
    schema_version: Literal['1.0'] = '1.0'
    snapshot_id: Id
    input_hash: str
    as_of: AwareDatetime
    farmer: Farmer
    field: Field
    season: Season
    soil_observations: list[SoilObservation] = []
    journal: list[JournalEntry] = []
    cost_ledger: list[LedgerLine] = []


class ReferenceBundle(ContractModel):
    schema_version: Literal['1.0'] = '1.0'
    version: str
    crops: list[Crop]
    products: list[Product]
    evidence: list[EvidenceRecord] = []
    # Scientific data is versioned by Phase 2; platform never interprets coefficients.
    parameters: dict[str, dict[str, JsonScalar]] = {}


class EvaluationBundle(ContractModel):
    recommendation: Recommendation
    water: WaterEstimate | None = None
    economics: Economics | None = None
    proposed_tasks: list[TaskSpec] = []
    data_mode: DataMode
    warnings: list[str] = []


class PlanningSnapshot(ContractModel):
    schema_version: Literal['1.0'] = '1.0'
    as_of: AwareDatetime
    field: Field
    request: PlanningRequest
    existing_seasons: list[Season] = []
    soil_observations: list[SoilObservation] = []


class ClimateBundle(ContractModel):
    location: Location
    period: DateInterval
    daily: list[ForecastDay] = []
    provenance: list[Provenance]
    data_mode: DataMode
    warnings: list[str] = []


class ClosureSnapshot(ContractModel):
    schema_version: Literal['1.0'] = '1.0'
    season: SeasonSnapshot
    closure: SeasonClosure
    recommendations: list[Recommendation] = []


class DomainEvent(ContractModel):
    schema_version: Literal['1.0'] = '1.0'
    event_id: Id
    event_type: Literal['field.updated', 'season.updated', 'journal.confirmed', 'recommendation.issued', 'recommendation.superseded', 'task.completed', 'season.closed']
    aggregate_id: Id
    aggregate_version: Version
    tenant_id: Id
    occurred_at: AwareDatetime
    payload_reference_id: Id


class AuditEvent(ContractModel):
    id: Id
    actor_id: Id
    tenant_id: Id
    action: str
    resource_id: Id
    occurred_at: AwareDatetime
    request_id: str
