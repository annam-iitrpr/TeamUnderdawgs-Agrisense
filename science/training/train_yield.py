"""Offline baseline/XGBoost job. Outputs candidate JSON and metrics, never promotes.

Input is an authorized JSONL export of YieldSample fields. Model/training datasets
belong in ignored storage. Synthetic samples require --software-test explicitly.
"""

import argparse
import json
from datetime import date, datetime
from hashlib import sha256
from pathlib import Path

import numpy as np
from agrisense.science.validation import (
    YieldSample,
    conformal_radius,
    interval_metrics,
    regression_metrics,
    split_forward_grouped,
)


def load_samples(path: Path) -> tuple[YieldSample, ...]:
    rows = []
    for line in path.read_text().splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        row["season_start"] = date.fromisoformat(row["season_start"])
        for key in ("prediction_at", "features_available_at", "harvest_at"):
            row[key] = datetime.fromisoformat(row[key])
        row["features"] = tuple(row["features"])
        rows.append(YieldSample(**row))
    if len({len(row.features) for row in rows}) != 1:
        raise ValueError("features must follow one immutable schema")
    return tuple(rows)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("dataset", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--calibration-start", type=date.fromisoformat, required=True)
    parser.add_argument("--test-start", type=date.fromisoformat, required=True)
    parser.add_argument("--model", choices=("baseline", "xgboost"), default="baseline")
    parser.add_argument("--software-test", action="store_true")
    args = parser.parse_args()
    samples = load_samples(args.dataset)
    synthetic = any(row.source_kind == "synthetic_software_test" for row in samples)
    if synthetic and not args.software_test:
        raise ValueError("synthetic rows cannot enter empirical training")
    splits = split_forward_grouped(
        samples, calibration_start=args.calibration_start, test_start=args.test_start
    )
    args.output.mkdir(parents=True, exist_ok=True)
    # No identifiers or row contents enter the public metric report.
    baseline = {
        name: np.asarray([row.baseline_kg_ha for row in rows])
        for name, rows in splits.items()
    }
    observed = {
        name: np.asarray([row.observed_kg_ha for row in rows])
        for name, rows in splits.items()
    }
    prediction = baseline.copy()
    if args.model == "xgboost":
        from xgboost import XGBRegressor

        features = {
            name: np.asarray(
                [
                    [np.nan if value is None else value for value in row.features]
                    for row in rows
                ]
            )
            for name, rows in splits.items()
        }
        model = XGBRegressor(
            n_estimators=100,
            max_depth=3,
            learning_rate=0.05,
            objective="reg:squarederror",
            random_state=2026,
            n_jobs=1,
        )
        model.fit(features["train"], observed["train"] - baseline["train"])
        prediction = {
            name: baseline[name] + model.predict(matrix)
            for name, matrix in features.items()
        }
        model.save_model(args.output / "candidate.ubj")
    else:
        # Only permitted training rows estimate baseline residual correction.
        bias = float(np.mean(observed["train"] - baseline["train"]))
        prediction = {name: values + bias for name, values in baseline.items()}
        (args.output / "candidate.json").write_text(
            json.dumps({"model": "baseline_residual_offset", "offset_kg_ha": bias})
        )
    radius = conformal_radius(
        tuple(observed["calibration"]), tuple(prediction["calibration"])
    )
    test_obs, test_pred = tuple(observed["test"]), tuple(prediction["test"])
    report = {
        "state": "software_test_only" if synthetic else "candidate_awaiting_review",
        "model": args.model,
        "dataset_sha256": sha256(args.dataset.read_bytes()).hexdigest(),
        "counts": {key: len(rows) for key, rows in splits.items()},
        "baseline": regression_metrics(test_obs, tuple(baseline["test"])),
        "candidate": regression_metrics(test_obs, test_pred),
        "conformal_radius_kg_ha": radius,
        "coverage": None
        if radius is None
        else interval_metrics(
            test_obs,
            tuple(value - radius for value in test_pred),
            tuple(value + radius for value in test_pred),
        ),
        "limitations": [
            "cluster_and_time_shift_limit_exchangeability",
            "not_causal_product_effect",
            "no_automatic_promotion",
        ],
    }
    (args.output / "evaluation.json").write_text(
        json.dumps(report, indent=2, allow_nan=False) + "\n"
    )
    print(json.dumps({"state": report["state"], "counts": report["counts"]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
