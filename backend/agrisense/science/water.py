"""FAO-56 standard-demand root-zone balance with explicit management inputs."""

from dataclasses import dataclass
from math import log

from .units import clip, finite, irrigation_litres


@dataclass(frozen=True)
class RootZone:
    field_capacity: float
    wilting_point: float
    root_depth_m: float
    depletion_fraction: float
    efficiency: float

    def __post_init__(self) -> None:
        finite(self.field_capacity, "field capacity", 0, 1)
        finite(self.wilting_point, "wilting point", 0, 1)
        finite(self.root_depth_m, "root depth", 0.001)
        finite(self.depletion_fraction, "p", 0, 1)
        finite(self.efficiency, "efficiency", 0, 1)
        if (
            self.field_capacity <= self.wilting_point
            or not 0 < self.depletion_fraction < 1
            or self.efficiency == 0
        ):
            raise ValueError("invalid root-zone parameters")

    @property
    def taw(self) -> float:
        return 1000 * (self.field_capacity - self.wilting_point) * self.root_depth_m


def root_zone_day(
    zone: RootZone,
    *,
    depletion_mm: float | None,
    et0_mm: float,
    kc: float,
    rain_mm: float,
    area_ha: float,
    irrigation_net_mm: float = 0,
    runoff_mm: float = 0,
    capillary_rise_mm: float = 0,
    deep_percolation_mm: float = 0,
    target_depletion_mm: float = 0,
    flooded_paddy: bool = False,
) -> dict:
    for name, value in locals().copy().items():
        if name in (
            "et0_mm",
            "kc",
            "rain_mm",
            "area_ha",
            "irrigation_net_mm",
            "runoff_mm",
            "capillary_rise_mm",
            "deep_percolation_mm",
            "target_depletion_mm",
        ):
            finite(value, name, 0)
    if runoff_mm > rain_mm or target_depletion_mm > zone.taw:
        raise ValueError("inconsistent runoff or target depletion")
    demand = kc * et0_mm
    if flooded_paddy or depletion_mm is None:
        return {
            "etc_mm": demand,
            "depletion_mm": None,
            "ks": None,
            "net_irrigation_mm": None,
            "gross_irrigation_mm": None,
            "litres": None,
            "reason": "paddy_management_required" if flooded_paddy else "initial_storage_unknown",
        }
    finite(depletion_mm, "initial depletion", 0, zone.taw)
    depletion = clip(
        depletion_mm
        + demand
        - (rain_mm - runoff_mm)
        - irrigation_net_mm
        - capillary_rise_mm
        + deep_percolation_mm,
        0,
        zone.taw,
    )
    raw = zone.depletion_fraction * zone.taw
    ks = 1 if depletion <= raw else clip((zone.taw - depletion) / (zone.taw - raw), 0, 1)
    net = max(0, depletion - target_depletion_mm)
    gross = net / zone.efficiency
    return {
        "etc_mm": demand,
        "depletion_mm": depletion,
        "ks": ks,
        "taw_mm": zone.taw,
        "raw_mm": raw,
        "net_irrigation_mm": net,
        "gross_irrigation_mm": gross,
        "litres": irrigation_litres(gross, area_ha),
        "irrigation_triggered": depletion > raw,
        "basis": "standard_demand_scenario",
    }


def wind_at_2m(speed_m_s: float, measurement_height_m: float) -> float:
    finite(speed_m_s, "wind", 0)
    finite(measurement_height_m, "wind height", 0.1, 100)
    return speed_m_s * 4.87 / log(67.8 * measurement_height_m - 5.42)


def fao56_et0(
    *,
    tmean_c: float,
    net_radiation_mj_m2_day: float,
    soil_heat_mj_m2_day: float,
    wind_2m_m_s: float,
    es_kpa: float,
    ea_kpa: float,
    slope_kpa_c: float,
    psychrometric_kpa_c: float,
) -> float:
    """Daily Penman–Monteith; caller must supply consistently derived radiation/pressure."""
    finite(tmean_c, "temperature", -90, 65)
    finite(net_radiation_mj_m2_day, "net radiation")
    finite(soil_heat_mj_m2_day, "soil heat")
    for value in (wind_2m_m_s, es_kpa, ea_kpa, slope_kpa_c, psychrometric_kpa_c):
        finite(value, "ET0 parameter", 0)
    if ea_kpa > es_kpa or slope_kpa_c + psychrometric_kpa_c <= 0:
        raise ValueError("invalid vapor pressure or denominator")
    numerator = 0.408 * slope_kpa_c * (
        net_radiation_mj_m2_day - soil_heat_mj_m2_day
    ) + psychrometric_kpa_c * 900 / (tmean_c + 273) * wind_2m_m_s * (es_kpa - ea_kpa)
    return max(0, numerator / (slope_kpa_c + psychrometric_kpa_c * (1 + 0.34 * wind_2m_m_s)))
