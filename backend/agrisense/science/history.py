"""Retained meteoblue daily reanalysis query; never an operational forecast.

Query and response metadata verified with a three-day live request on 2026-09-10.
Long imports belong in platform jobs; each call here is limited to one year.
"""

from datetime import UTC, date, datetime
from typing import Any

from .providers import JsonTransport, ProviderUnavailable, payload_hash
from .units import finite
from .weather import Daily, WeatherBundle, utc

SOURCE = "meteoblue:ERA5T-gapfill-ERA5"
CODES = (
    (11, "max", "2 m above gnd", "°C"),
    (11, "min", "2 m above gnd", "°C"),
    (61, "sum", "sfc", "mm"),
)


def history_query(latitude: float, longitude: float, start: date, end: date) -> dict:
    finite(latitude, "latitude", -90, 90)
    finite(longitude, "longitude", -180, 180)
    if not 0 <= (end - start).days <= 365:
        raise ValueError("history interval must be ordered and at most 366 days inclusive")
    return {
        "units": {"temperature": "C", "velocity": "km/h", "length": "metric", "energy": "watts"},
        "geometry": {"type": "MultiPoint", "coordinates": [[longitude, latitude]]},
        "format": "json",
        "timeIntervals": [f"{start.isoformat()}T+00:00/{end.isoformat()}T+00:00"],
        "timeIntervalsAlignment": "none",
        "queries": [
            {
                "domain": "ERA5T",
                "gapFillDomain": "ERA5",
                "timeResolution": "daily",
                "codes": [
                    {"code": code, "level": level, "aggregation": aggregation}
                    for code, aggregation, level, _ in CODES
                ],
            }
        ],
    }


def parse_history(payload: Any, *, start: date, end: date, retrieved_at: datetime) -> WeatherBundle:
    if not isinstance(payload, list) or len(payload) != 1:
        raise ValueError("one reanalysis result block required")
    block = payload[0]
    if block["domain"] != "ERA5T" or block["timeResolution"] != "daily":
        raise ValueError("unexpected history dataset or resolution")
    if len(block["timeIntervals"]) != 1:
        raise ValueError("one history time interval required")
    stamps = block["timeIntervals"][0]
    times = [datetime.strptime(stamp, "%Y%m%dT%H%M").replace(tzinfo=UTC) for stamp in stamps]
    if any(stamp.hour or stamp.minute for stamp in times):
        raise ValueError("history query requires UTC calendar days")
    days = [stamp.date() for stamp in times]
    if not days or days != sorted(set(days)) or any(not start <= day <= end for day in days):
        raise ValueError("empty, unordered, duplicated or out-of-range history dates")
    series = {}
    for column in block["codes"]:
        identity = (column["code"], column["aggregation"], column["level"], column["unit"])
        if identity not in CODES or identity in series:
            raise ValueError("unexpected or duplicate historical code/units")
        intervals = column["dataPerTimeInterval"]
        if len(intervals) != 1 or len(intervals[0]["data"]) != 1:
            raise ValueError("one history interval and grid series required")
        values = intervals[0]["data"][0]
        if len(values) != len(days):
            raise ValueError("history timestamps and values differ in length")
        series[identity] = [None if value is None else float(value) for value in values]
    if set(series) != set(CODES):
        raise ValueError("required historical codes absent")
    maximum, minimum, rain = (series[code] for code in CODES)
    daily = tuple(
        Daily(day.isoformat(), minimum[i], maximum[i], rain[i], None, SOURCE)
        for i, day in enumerate(days)
    )
    if not any(
        value is not None for row in daily for value in (row.tmin_c, row.tmax_c, row.rain_mm)
    ):
        raise ValueError("history contains only missing data")
    return WeatherBundle(
        SOURCE,
        retrieved_at,
        daily=daily,
        mode="estimated",
        raw_payload_hash=payload_hash(payload),
        warnings=(
            "reanalysis_not_archived_forecast",
            "gapfill_ERA5_configured",
            "et0_humidity_wind_radiation_not_requested",
            "daily_calendar_UTC",
            "grid_resolution_unknown",
        ),
    )


class MeteoblueHistoryProvider:
    name = "meteoblue"
    capabilities = frozenset({"history_daily"})

    def __init__(self, transport: JsonTransport, *, api_key: str):
        if not api_key:
            raise ValueError("meteoblue key required")
        self.transport, self._api_key = transport, api_key

    async def history(
        self, location: tuple[float, float], start: date, end: date, as_of: datetime
    ) -> WeatherBundle:
        if end >= utc(as_of).date():
            raise ValueError("reanalysis request must end before as_of day")
        body = history_query(*location, start, end)
        payload = await self.transport.request(
            self.name,
            "POST",
            "https://my.meteoblue.com/dataset/query",
            params={"apikey": self._api_key},
            json=body,
        )
        # Never log/persist a queue response, which can echo the API key. Do not
        # enqueue repeatedly in an HTTP evaluation; platform owns durable jobs.
        if isinstance(payload, dict):
            code = (
                "history_job_requires_platform_worker"
                if payload.get("status") in ("waiting", "running", "finished")
                or payload.get("requiresJobQueue")
                else "invalid_history_schema"
            )
            raise ProviderUnavailable(self.name, code)
        try:
            return parse_history(payload, start=start, end=end, retrieved_at=datetime.now(UTC))
        except (ValueError, TypeError, KeyError, IndexError, AttributeError):
            raise ProviderUnavailable(self.name, "invalid_history_schema") from None
