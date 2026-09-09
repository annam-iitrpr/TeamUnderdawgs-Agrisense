"""Offline validation primitives; no training imports during service startup."""

from dataclasses import dataclass
from datetime import date, datetime
from math import ceil, sqrt
from random import Random

from .economics import quantile
from .units import finite
from .weather import utc


@dataclass(frozen=True)
class YieldSample:
    sample_id: str
    farmer_id: str
    field_id: str
    crop_id: str
    district: str
    season_start: date
    prediction_at: datetime
    features_available_at: datetime
    harvest_at: datetime
    baseline_kg_ha: float
    observed_kg_ha: float
    features: tuple[float | None, ...]
    source_kind: str
    label_available_at: datetime | None = None

    def __post_init__(self) -> None:
        if not all((self.sample_id, self.farmer_id, self.field_id, self.crop_id, self.district)):
            raise ValueError("dataset identity incomplete")
        if not utc(self.features_available_at) <= utc(self.prediction_at) < utc(self.harvest_at):
            raise ValueError("future feature or invalid prediction/harvest chronology")
        finite(self.baseline_kg_ha, "baseline yield", 0)
        finite(self.observed_kg_ha, "observed yield", 0)
        for value in self.features:
            if value is not None:
                finite(value, "feature")
        if self.source_kind not in ("confirmed_field_outcome", "synthetic_software_test"):
            raise ValueError("unrecognized label provenance")
        if self.label_available_at is None and self.source_kind == "confirmed_field_outcome":
            raise ValueError("empirical labels require their actual availability time")
        if self.label_available_at is not None and utc(self.label_available_at) < utc(
            self.harvest_at
        ):
            raise ValueError("yield label cannot precede harvest")

    @property
    def residual_kg_ha(self) -> float:
        return self.observed_kg_ha - self.baseline_kg_ha


def split_forward_grouped(
    samples: tuple[YieldSample, ...],
    *,
    calibration_start: date,
    test_start: date,
    held_out_districts: frozenset[str] = frozenset(),
) -> dict[str, tuple[YieldSample, ...]]:
    if calibration_start >= test_start or len({row.sample_id for row in samples}) != len(samples):
        raise ValueError("invalid split dates or duplicate sample identity")
    ordered = sorted(samples, key=lambda row: (row.season_start, row.sample_id))
    test = tuple(row for row in ordered if row.season_start >= test_start)
    held_farmers = {row.farmer_id for row in test}
    held_fields = {row.field_id for row in test}
    before_test = [
        row
        for row in ordered
        if row.season_start < test_start
        and row.farmer_id not in held_farmers
        and row.field_id not in held_fields
        and row.district not in held_out_districts
    ]
    calibration = tuple(
        row
        for row in before_test
        if row.season_start >= calibration_start
        and (row.label_available_at or row.harvest_at).date() < test_start
    )
    cal_farmers, cal_fields = (
        {row.farmer_id for row in calibration},
        {row.field_id for row in calibration},
    )
    train = tuple(
        row
        for row in before_test
        if row.season_start < calibration_start
        and (row.label_available_at or row.harvest_at).date() < calibration_start
        and row.farmer_id not in cal_farmers
        and row.field_id not in cal_fields
    )
    if not train or not calibration or not test:
        raise ValueError("insufficient independent train/calibration/test groups")
    return {"train": train, "calibration": calibration, "test": test}


def regression_metrics(observed: tuple[float, ...], predicted: tuple[float, ...]) -> dict:
    if not observed or len(observed) != len(predicted):
        raise ValueError("paired nonempty observed/predicted vectors required")
    for value in observed + predicted:
        finite(value, "metric input")
    errors = [prediction - actual for actual, prediction in zip(observed, predicted)]
    return {
        "n": len(errors),
        "mae": sum(abs(e) for e in errors) / len(errors),
        "rmse": sqrt(sum(e * e for e in errors) / len(errors)),
        "bias": sum(errors) / len(errors),
        "units": "target_units",
        "error_definition": "prediction_minus_observed",
    }


def pinball_loss(
    observed: tuple[float, ...], predicted: tuple[float, ...], probability: float
) -> float:
    finite(probability, "quantile probability", 0, 1)
    regression_metrics(observed, predicted)
    return sum(
        max(probability * (actual - prediction), (probability - 1) * (actual - prediction))
        for actual, prediction in zip(observed, predicted)
    ) / len(observed)


def interval_metrics(
    observed: tuple[float, ...], lower: tuple[float, ...], upper: tuple[float, ...]
) -> dict:
    regression_metrics(observed, lower)
    regression_metrics(observed, upper)
    if any(lo > hi for lo, hi in zip(lower, upper)):
        raise ValueError("crossing intervals")
    return {
        "coverage": sum(lo <= value <= hi for value, lo, hi in zip(observed, lower, upper))
        / len(observed),
        "mean_width": sum(hi - lo for lo, hi in zip(lower, upper)) / len(observed),
        "n": len(observed),
    }


def conformal_radius(
    observed: tuple[float, ...], predicted: tuple[float, ...], alpha: float = 0.2
) -> float | None:
    regression_metrics(observed, predicted)
    if not 0 < alpha < 1:
        raise ValueError("alpha must be strictly between zero and one")
    rank = ceil((len(observed) + 1) * (1 - alpha))
    if rank > len(observed):
        return None
    return sorted(abs(actual - prediction) for actual, prediction in zip(observed, predicted))[
        rank - 1
    ]


def clustered_mae_interval(
    observed: tuple[float, ...],
    predicted: tuple[float, ...],
    groups: tuple[str, ...],
    draws: int = 2000,
    seed: int = 2026,
) -> dict:
    regression_metrics(observed, predicted)
    if len(groups) != len(observed) or not 100 <= draws <= 10000:
        raise ValueError("invalid cluster bootstrap")
    clusters: dict[str, list[float]] = {}
    for actual, prediction, group in zip(observed, predicted, groups):
        clusters.setdefault(group, []).append(abs(actual - prediction))
    keys = sorted(clusters)
    if len(keys) < 2:
        return {"low": None, "high": None, "reason": "independent_clusters_required"}
    rng = Random(seed)
    values = []
    for _ in range(draws):
        errors = [error for _ in keys for error in clusters[keys[rng.randrange(len(keys))]]]
        values.append(sum(errors) / len(errors))
    return {
        "low": quantile(values, 0.025),
        "high": quantile(values, 0.975),
        "clusters": len(keys),
        "seed": seed,
    }


def promotion_gate(
    *,
    dataset_kind: str,
    candidate_mae: float,
    baseline_mae: float,
    empirical_coverage: float,
    minimum_coverage: float,
    subgroup_regressions: list[str],
    reviewer_id: str | None,
    evaluation_hash: str | None,
    hard_violations: int,
) -> dict:
    for value in (candidate_mae, baseline_mae):
        finite(value, "MAE", 0)
    for value in (empirical_coverage, minimum_coverage):
        finite(value, "coverage", 0, 1)
    reasons = []
    if dataset_kind != "confirmed_field_outcome":
        reasons.append("empirical_labels_required")
    if candidate_mae >= baseline_mae:
        reasons.append("candidate_does_not_improve_baseline")
    if empirical_coverage < minimum_coverage:
        reasons.append("coverage_below_preregistered_target")
    if subgroup_regressions:
        reasons.append("subgroup_regression_requires_review")
    if hard_violations != 0:
        reasons.append("hard_constraint_violations")
    if not reviewer_id or not evaluation_hash:
        reasons.append("authorized_review_and_immutable_evaluation_required")
    return {"eligible_for_promotion": not reasons, "reasons": reasons, "automatic_promotion": False}
