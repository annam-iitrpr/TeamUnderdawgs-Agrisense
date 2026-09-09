"""Explicit unit boundaries; missing measurements are never invented."""

from math import isfinite


def finite(
    value: float, name: str, minimum: float | None = None, maximum: float | None = None
) -> float:
    if isinstance(value, bool) or not isfinite(value):
        raise ValueError(f"{name} must be finite")
    if minimum is not None and value < minimum:
        raise ValueError(f"{name} below minimum")
    if maximum is not None and value > maximum:
        raise ValueError(f"{name} above maximum")
    return value


def clip(value: float, low: float, high: float) -> float:
    finite(value, "value")
    if low > high:
        raise ValueError("invalid interval")
    return min(max(value, low), high)


def area_to_ha(value: float, unit: str) -> float:
    finite(value, "area", 0)
    return value * {"ha": 1.0, "acre": 0.40468564224, "m2": 0.0001}[unit]


def irrigation_litres(depth_mm: float, area_ha: float) -> float:
    return finite(depth_mm, "depth", 0) * finite(area_ha, "area", 0) * 10000


def wind_kmh(value: float | None, unit: str) -> float | None:
    if value is None:
        return None
    return finite(value, "wind", 0) * {"km/h": 1, "m/s": 3.6}[unit]


def radiation_wm2(energy_whm2: float, interval_hours: float) -> float:
    finite(interval_hours, "interval", 0)
    if interval_hours == 0:
        raise ValueError("interval must be positive")
    return finite(energy_whm2, "radiation", 0) / interval_hours


def soil_mass_kg_ha(concentration_g_kg: float, bulk_density_kg_m3: float, depth_m: float) -> float:
    """Mass only: total nutrient concentration does NOT imply plant availability."""
    return (
        finite(concentration_g_kg, "concentration", 0)
        * finite(bulk_density_kg_m3, "bulk density", 1)
        * finite(depth_m, "depth", 0.001)
        * 10
    )
