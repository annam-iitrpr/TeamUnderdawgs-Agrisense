"""Auditable soil, market and satellite transformations; no invented observations."""

from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal

import numpy as np

from .economics import MoneyInput, decimal, price_per_kg
from .units import finite
from .weather import utc


@dataclass(frozen=True)
class MarketQuote:
    crop_id: str
    product_form: str
    market: str
    variety: str
    grade: str
    observed_on: date
    minimum_inr_kg: Decimal
    modal_inr_kg: Decimal
    maximum_inr_kg: Decimal
    source_id: str

    def __post_init__(self) -> None:
        if not all((self.crop_id, self.product_form, self.market, self.source_id)):
            raise ValueError("market identity and product form are required")
        values = [
            decimal(value)
            for value in (self.minimum_inr_kg, self.modal_inr_kg, self.maximum_inr_kg)
        ]
        if min(values) < 0 or values != sorted(values):
            raise ValueError("invalid ordered market prices")

    def farmgate(
        self,
        *,
        expected_product_form: str,
        transport_and_fees_inr_kg: MoneyInput,
        quality_discount_fraction: MoneyInput,
        as_of: date,
        max_age_days: int = 7,
    ) -> dict:
        if expected_product_form != self.product_form:
            raise ValueError("market crop product form mismatch")
        fees, discount = decimal(transport_and_fees_inr_kg), decimal(quality_discount_fraction)
        if fees < 0 or not 0 <= discount <= 1 or self.observed_on > as_of or max_age_days < 0:
            raise ValueError("invalid farmgate adjustment or observation date")
        value = self.modal_inr_kg * (1 - discount) - fees
        return {
            "price_inr_kg": max(Decimal(0), value),
            "observed_on": self.observed_on.isoformat(),
            "stale": (as_of - self.observed_on).days > max_age_days,
            "basis": "market_quote_adjusted_scenario",
            "is_harvest_price_forecast": False,
            "assumptions": ["fees_already_deducted_do_not_duplicate_in_cost_ledger"],
        }


def market_quote(
    record: dict, *, source_id: str, product_form: str, price_unit: str
) -> MarketQuote:
    """Import a reviewed normalized CSV/JSON row; provider mapping is explicit."""
    return MarketQuote(
        str(record["crop_id"]),
        product_form,
        str(record["market"]),
        str(record["variety"]),
        str(record["grade"]),
        date.fromisoformat(str(record["observed_on"])),
        price_per_kg(str(record["minimum_price"]), price_unit),
        price_per_kg(str(record["modal_price"]), price_unit),
        price_per_kg(str(record["maximum_price"]), price_unit),
        source_id,
    )


def soilgrids_layer(
    raw_value: float | None,
    *,
    scale_divisor: float,
    property_name: str,
    unit: str,
    depth_top_cm: float,
    depth_bottom_cm: float,
    metadata_evidence_id: str,
) -> dict:
    finite(scale_divisor, "metadata scale divisor", 0.000001)
    finite(depth_top_cm, "depth top", 0)
    finite(depth_bottom_cm, "depth bottom", depth_top_cm)
    if depth_bottom_cm == depth_top_cm or not metadata_evidence_id:
        raise ValueError("nonzero depth and verified scaling metadata required")
    value = None if raw_value is None else finite(raw_value, "gridded value") / scale_divisor
    return {
        "value": value,
        "unit": unit,
        "property": property_name,
        "source": "gridded_estimate",
        "depth_top_cm": depth_top_cm,
        "depth_bottom_cm": depth_bottom_cm,
        "metadata_evidence_id": metadata_evidence_id,
        "plant_available_nitrogen": None,
        "warnings": [
            "spatial_prior_not_lab_measurement",
            "total_nitrogen_not_fertilizer_available_nitrogen",
        ],
    }


def ndvi_summary(
    red: np.ndarray,
    nir: np.ndarray,
    valid_mask: np.ndarray,
    *,
    captured_at: datetime,
    reflectance_scale: float,
    reflectance_offset: float,
    scene_id: str,
) -> dict:
    utc(captured_at)
    if (
        red.shape != nir.shape
        or red.shape != valid_mask.shape
        or red.size == 0
        or valid_mask.dtype != bool
    ):
        raise ValueError("aligned nonempty bands and boolean cloud/shadow/field mask required")
    finite(reflectance_scale, "reflectance scale", 0.00000001)
    finite(reflectance_offset, "reflectance offset")
    if not scene_id:
        raise ValueError("scene identity required")
    red_values = np.asarray(red, dtype=float) * reflectance_scale + reflectance_offset
    nir_values = np.asarray(nir, dtype=float) * reflectance_scale + reflectance_offset
    denominator = nir_values + red_values
    mask = valid_mask & np.isfinite(red_values) & np.isfinite(nir_values) & (denominator != 0)
    values = np.divide(
        nir_values - red_values, denominator, out=np.full_like(denominator, np.nan), where=mask
    )
    mask &= (values >= -1) & (values <= 1)
    good = values[mask]
    return {
        "median": None if good.size == 0 else float(np.median(good)),
        "interquartile_range": None
        if good.size == 0
        else float(np.quantile(good, 0.75) - np.quantile(good, 0.25)),
        "valid_pixel_fraction": float(good.size / red.size),
        "scene_id": scene_id,
        "captured_at": utc(captured_at).isoformat(),
        "basis": "vegetation_greenness",
        "warnings": [
            "not_soil_moisture_or_product_efficacy",
            "tiny_fields_and_mixed_pixels_require_review",
        ],
    }
