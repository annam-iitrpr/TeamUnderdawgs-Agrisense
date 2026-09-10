"""Filling a missing daily reference ET0 from a provider that publishes one.

Without ET0 the soil water balance cannot run, so every water figure in the
product was blank even though temperature, rain, humidity, wind and radiation
were all present. CE Hub's daily series carries no reference ET0.

Deriving it here was rejected: FAO-56 Penman-Monteith needs a net-radiation
chain and an atmospheric pressure derived from field elevation, and elevation is
collected nowhere in the product. A published reference ET0 is better evidence
than a derivation resting on an assumed altitude.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from agrisense.science.providers import ProviderUnavailable, fill_reference_et0
from agrisense.science.weather import Daily, WeatherBundle

NOW = datetime(2026, 9, 10, tzinfo=UTC)


def day(date: str, et0: float | None, source: str = "cehub:Meteoblue") -> Daily:
    return Daily(date=date, tmin_c=24.0, tmax_c=35.0, rain_mm=0.0, et0_mm=et0, source=source)


class Donor:
    """A provider that publishes reference ET0 for the dates it is given."""

    name = "open-meteo"
    capabilities = frozenset({"forecast_hourly", "forecast_daily"})

    def __init__(self, values: dict[str, float | None], *, fails: bool = False) -> None:
        self.values = values
        self.fails = fails
        self.calls = 0

    async def forecast(self, location, horizon, as_of) -> WeatherBundle:
        self.calls += 1
        if self.fails:
            raise ProviderUnavailable(self.name, "transport_error")
        return WeatherBundle(
            self.name,
            NOW,
            daily=tuple(
                Daily(date=date, tmin_c=None, tmax_c=None, rain_mm=None, et0_mm=value,
                      source=self.name)
                for date, value in self.values.items()
            ),
        )


async def fill(bundle: WeatherBundle, *donors) -> WeatherBundle:
    return await fill_reference_et0(
        bundle, (30.9, 75.85), 7, NOW, providers=tuple(donors), exclude=None
    )


@pytest.mark.asyncio
async def test_missing_values_are_filled_and_the_substitution_is_recorded():
    donor = Donor({"2026-09-10": 4.78, "2026-09-11": 4.62})
    bundle = WeatherBundle("cehub:Meteoblue", NOW,
                           daily=(day("2026-09-10", None), day("2026-09-11", None)))
    result = await fill(bundle, donor)
    assert [row.et0_mm for row in result.daily] == [4.78, 4.62]
    # A mixed-provider day must be visible, not pass as one coherent observation.
    assert all("open-meteo:et0" in row.source for row in result.daily)
    assert any("reference_et0_substituted_for_2_days" in w for w in result.warnings)


@pytest.mark.asyncio
async def test_a_primary_value_is_never_overwritten():
    """The primary provider wins on everything it actually supplies."""
    donor = Donor({"2026-09-10": 9.99, "2026-09-11": 4.62})
    bundle = WeatherBundle("cehub:Meteoblue", NOW,
                           daily=(day("2026-09-10", 3.10), day("2026-09-11", None)))
    result = await fill(bundle, donor)
    assert result.daily[0].et0_mm == 3.10
    assert result.daily[0].source == "cehub:Meteoblue"
    assert result.daily[1].et0_mm == 4.62
    assert any("substituted_for_1_days" in w for w in result.warnings)


@pytest.mark.asyncio
async def test_dates_are_matched_never_aligned_by_position():
    """The two providers can return different horizons and different start days.

    Filling by index would silently attach one day's evapotranspiration to
    another day's rain, which is worse than leaving it unknown.
    """
    donor = Donor({"2026-09-11": 4.62, "2026-09-12": 4.12})
    bundle = WeatherBundle("cehub:Meteoblue", NOW,
                           daily=(day("2026-09-10", None), day("2026-09-11", None)))
    result = await fill(bundle, donor)
    assert result.daily[0].et0_mm is None, "an unmatched date was filled from the wrong day"
    assert result.daily[1].et0_mm == 4.62


@pytest.mark.asyncio
async def test_nothing_missing_means_no_donor_request_at_all():
    donor = Donor({"2026-09-10": 4.78})
    bundle = WeatherBundle("cehub:Meteoblue", NOW, daily=(day("2026-09-10", 3.10),))
    result = await fill(bundle, donor)
    assert donor.calls == 0
    assert result is bundle


@pytest.mark.asyncio
async def test_a_failing_donor_is_skipped_and_the_next_is_tried():
    broken, good = Donor({}, fails=True), Donor({"2026-09-10": 4.78})
    bundle = WeatherBundle("cehub:Meteoblue", NOW, daily=(day("2026-09-10", None),))
    result = await fill(bundle, broken, good)
    assert broken.calls == 1 and good.calls == 1
    assert result.daily[0].et0_mm == 4.78


@pytest.mark.asyncio
async def test_no_donor_leaves_et0_unknown_and_says_why():
    """Unknown ET0 is reported, never defaulted. A zero would mean no crop demand."""
    bundle = WeatherBundle("cehub:Meteoblue", NOW, daily=(day("2026-09-10", None),))
    result = await fill(bundle)
    assert result.daily[0].et0_mm is None
    assert "reference_et0_unavailable_for_daily_water_balance" in result.warnings


@pytest.mark.asyncio
async def test_a_donor_with_no_et0_of_its_own_is_not_treated_as_a_source():
    donor = Donor({"2026-09-10": None})
    bundle = WeatherBundle("cehub:Meteoblue", NOW, daily=(day("2026-09-10", None),))
    result = await fill(bundle, donor)
    assert result.daily[0].et0_mm is None
    assert "reference_et0_unavailable_for_daily_water_balance" in result.warnings


@pytest.mark.asyncio
async def test_the_bundle_provider_is_excluded_by_identity_not_by_name():
    """The bundle is labelled `cehub:Meteoblue` while the provider is `cehub`.

    A string comparison let the primary re-fetch itself: a duplicate round trip
    that could not supply the missing value anyway.
    """
    primary = Donor({"2026-09-10": 4.78})
    primary.name = "cehub"
    bundle = WeatherBundle("cehub:Meteoblue", NOW, daily=(day("2026-09-10", None),))
    result = await fill_reference_et0(
        bundle, (30.9, 75.85), 7, NOW, providers=(primary,), exclude=primary
    )
    assert primary.calls == 0
    assert result.daily[0].et0_mm is None
