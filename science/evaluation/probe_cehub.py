"""Read-only CE Hub capability probe; never prints credentials, URLs or error bodies.

Run with an explicit ignored --env path. Successful weather/metadata payloads are
saved only to an ignored local output directory for schema inspection.
"""

import argparse
import json
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from pathlib import Path

import httpx


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--env", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path(".local/cehub"))
    args = parser.parse_args()
    values = {}
    for line in args.env.read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip("\"'")
    key = values.get("CEHUB_API_KEY")
    token = values.get("CEHUB_BEARER_TOKEN")
    if bool(key) == bool(token):
        print("Configure exactly one CE Hub authentication mode")
        return 1
    headers = (
        {values.get("CEHUB_API_KEY_HEADER", "ApiKey"): key}
        if key
        else {"Authorization": f"Bearer {token}"}
    )
    now = datetime.now(UTC)
    requests = [
        ("metadata", "/api/Forecast/Metadata", {"measureType": "Hourly"}),
        ("metadata_daily", "/api/Forecast/Metadata", {"measureType": "Daily"}),
        (
            "daily",
            "/api/Forecast/ShortRangeForecastDaily",
            {
                "latitude": 30.97,
                "longitude": 76.47,
                "startDate": now.date().isoformat(),
                "endDate": (now + timedelta(days=2)).date().isoformat(),
                "supplier": "Meteoblue",
                "format": "json",
                "measureLabel": "TempAir_DailyMax (C);TempAir_DailyMin (C);Precip_DailySum (mm)",
            },
        ),
        (
            "hourly",
            "/api/Forecast/ShortRangeForecastHourly",
            {
                "latitude": 30.97,
                "longitude": 76.47,
                "startDate": now.date().isoformat(),
                "endDate": (now + timedelta(days=2)).date().isoformat(),
                "supplier": "Meteoblue",
                "format": "json",
                "measureLabel": "TempAir_Hourly (C);HumidityRel_Hourly (pct);Precip_HourlySum (mm);WindSpeed_Hourly (m/s);GlobalRadiation_HourlySum (Wh/m2)",
            },
        ),
    ]
    args.output.mkdir(parents=True, exist_ok=True)
    with httpx.Client(
        base_url="https://services.cehub.syngenta-ais.com",
        headers=headers,
        timeout=25,
        follow_redirects=False,
    ) as client:
        for name, path, params in requests:
            try:
                response = client.get(path, params=params)
                report = {"capability": name, "http_status": response.status_code}
                if response.status_code == 200:
                    payload = response.json()
                    raw = json.dumps(payload, sort_keys=True)
                    # Defensive check: never persist an echoed credential.
                    if any(secret and secret in raw for secret in (key, token)):
                        raise ValueError("credential_echo")
                    (args.output / f"{name}.json").write_text(raw)
                    report.update(
                        sha256=sha256(raw.encode()).hexdigest(),
                        payload_type=type(payload).__name__,
                        records=len(payload)
                        if isinstance(payload, (dict, list))
                        else None,
                    )
                print(json.dumps(report))
            except (httpx.HTTPError, ValueError) as exc:
                print(
                    json.dumps({"capability": name, "error_type": type(exc).__name__})
                )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
