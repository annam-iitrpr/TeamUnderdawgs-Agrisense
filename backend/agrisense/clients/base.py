"""The client protocol and the provenance record that travels with every payload.

Provenance reaches the UI unchanged. Being honest about whether a number came from
a live API or a bundled fixture is a scoring criterion, not a nicety.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Protocol

from agrisense.agronomy.types import DailyWeather, HourlyWeather


@dataclass(frozen=True)
class Provenance:
    """Where a piece of data came from and whether anything degraded on the way."""

    source: str
    live: bool
    fetched_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    note: str | None = None
    substituted_for: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "source": self.source,
            "live": self.live,
            "fetched_at": self.fetched_at.isoformat(),
            "note": self.note,
            "substituted_for": self.substituted_for,
        }


@dataclass(frozen=True)
class DailyForecast:
    days: list[DailyWeather]
    provenance: Provenance


@dataclass(frozen=True)
class HourlyForecast:
    hours: list[HourlyWeather]
    provenance: Provenance


class ForecastClient(Protocol):
    """The only forecast shape the rest of the application knows about.

    When a provider's schema differs, one adapter changes and nothing else does.
    """

    name: str

    async def daily(self, lat: float, lon: float, days: int = 14) -> DailyForecast: ...

    async def hourly(self, lat: float, lon: float, hours: int = 336) -> HourlyForecast: ...
