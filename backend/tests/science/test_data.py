from datetime import UTC, date, datetime
from decimal import Decimal

import numpy as np
import pytest

from agrisense.science.data import market_quote, ndvi_summary, soilgrids_layer


def test_market_units_form_staleness_and_fee_basis():
    quote = market_quote(
        {
            "crop_id": "rice",
            "market": "synthetic",
            "variety": "synthetic",
            "grade": "test",
            "observed_on": "2026-09-01",
            "minimum_price": 1800,
            "modal_price": 2000,
            "maximum_price": 2200,
        },
        source_id="synthetic",
        product_form="paddy",
        price_unit="INR/quintal",
    )
    assert quote.modal_inr_kg == Decimal(20)
    result = quote.farmgate(
        expected_product_form="paddy",
        transport_and_fees_inr_kg=1,
        quality_discount_fraction="0.1",
        as_of=date(2026, 9, 10),
    )
    assert result["price_inr_kg"] == Decimal(17)
    assert result["stale"] is True
    with pytest.raises(ValueError):
        quote.farmgate(
            expected_product_form="milled_rice",
            transport_and_fees_inr_kg=0,
            quality_discount_fraction=0,
            as_of=date(2026, 9, 10),
        )


def test_ndvi_cloud_zero_and_explicit_scale_offset():
    args = {
        "captured_at": datetime(2026, 9, 10, tzinfo=UTC),
        "reflectance_scale": 0.0001,
        "reflectance_offset": 0,
        "scene_id": "synthetic",
    }
    result = ndvi_summary(
        np.array([2000, 0, 9000]), np.array([6000, 0, 1000]), np.array([True, True, False]), **args
    )
    assert result["median"] == pytest.approx(0.5)
    assert result["valid_pixel_fraction"] == pytest.approx(1 / 3)
    result = ndvi_summary(np.array([1]), np.array([2]), np.array([False]), **args)
    assert result["median"] is None


def test_soilgrids_never_becomes_available_n():
    result = soilgrids_layer(
        100,
        scale_divisor=100,
        property_name="total_nitrogen",
        unit="g/kg",
        depth_top_cm=0,
        depth_bottom_cm=15,
        metadata_evidence_id="synthetic",
    )
    assert result["value"] == 1
    assert result["plant_available_nitrogen"] is None
