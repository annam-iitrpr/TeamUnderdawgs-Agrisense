"""Live weather-to-science smoke test with a synthetic identity; no auth/API claim."""

import argparse
import asyncio
import json
import os
from datetime import UTC, datetime
from pathlib import Path

from agrisense.contracts_generated import models as api
from agrisense.science.facade import build_weather_bundle, evaluate_season
from agrisense.science.providers import ProviderUnavailable
from agrisense.science.references import reference_bundle


async def run(
    env_path: Path,
    *,
    horizon: int = 10,
    latitude: float = 21.1,
    longitude: float = 79.1,
) -> int:
    # Use only the relevant supplied credentials; never print environment values.
    allowed = {"CEHUB_API_KEY", "CEHUB_BEARER_TOKEN", "CEHUB_API_KEY_HEADER"}
    for line in env_path.read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key, value = line.split("=", 1)
            if key.strip() in allowed:
                os.environ[key.strip()] = value.strip().strip("\"'")
    root = Path(__file__).resolve().parents[2]
    snapshot = api.SeasonSnapshot.model_validate_json(
        (root / "contracts/fixtures/cotton.snapshot.json").read_text()
    )
    snapshot.field.centroid = api.Location(
        latitude=latitude, longitude=longitude, source="manual"
    )
    try:
        snapshot.as_of = datetime.now(UTC)
        forecast = await build_weather_bundle(
            snapshot.field.centroid, horizon, snapshot.as_of
        )
        references = reference_bundle()
        result = evaluate_season(snapshot, forecast, references)
    except (ProviderUnavailable, ValueError, TypeError, KeyError) as exc:
        # This CLI deliberately suppresses all exception messages and tracebacks.
        report = {"status": "failed", "error_type": type(exc).__name__}
        if isinstance(exc, ProviderUnavailable):
            report.update(
                provider=exc.provider, code=exc.code, diagnostics=exc.diagnostics
            )
        print(json.dumps(report))
        return 1
    print(
        json.dumps(
            {
                "status": "passed",
                "provider": forecast.provider,
                "forecast_mode": forecast.data_mode,
                "hourly_records": len(forecast.hourly),
                "requested_horizon_days": horizon,
                "invalid_radiation_records": sum(
                    row.radiation_w_m2 is not None
                    and row.radiation_w_m2.missing_reason == "provider_value_invalid"
                    for row in forecast.hourly
                ),
                "daily_records": len(forecast.daily),
                "stress_points": len(result.recommendation.stress_curve),
                "recommendation_status": result.recommendation.status,
                "incremental_value": result.recommendation.incremental_value.p50,
                "synthetic_identity": True,
                "authenticated_api_test": False,
                "warnings": forecast.warnings,
            }
        )
    )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--env", type=Path, required=True)
    parser.add_argument("--horizon", type=int, choices=range(1, 15), default=10)
    parser.add_argument("--latitude", type=float, default=21.1)
    parser.add_argument("--longitude", type=float, default=79.1)
    args = parser.parse_args()
    return asyncio.run(
        run(
            args.env,
            horizon=args.horizon,
            latitude=args.latitude,
            longitude=args.longitude,
        )
    )


if __name__ == "__main__":
    raise SystemExit(main())
