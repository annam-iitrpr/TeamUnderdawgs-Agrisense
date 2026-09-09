"""Auditable budget arithmetic and paired empirical/scenario resampling."""

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from random import Random
from typing import Literal

MoneyInput = Decimal | int | str


def decimal(value: MoneyInput) -> Decimal:
    if isinstance(value, (bool, float)):
        raise TypeError("money inputs must be Decimal, integer or decimal string")
    result = Decimal(value)
    if not result.is_finite():
        raise ValueError("nonfinite economic input")
    return result


def money(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def price_per_kg(value: MoneyInput, unit: str) -> Decimal:
    result = decimal(value)
    if result < 0:
        raise ValueError("negative price")
    return (
        result / {"INR/kg": Decimal(1), "INR/quintal": Decimal(100), "paise/kg": Decimal(100)}[unit]
    )


@dataclass(frozen=True)
class CostLine:
    key: str
    amount_inr: Decimal | None
    basis: Literal["planned", "actual"]
    revision: int = 1
    event_id: str | None = None

    def __post_init__(self) -> None:
        if not self.key or self.revision < 1 or self.basis not in ("planned", "actual"):
            raise ValueError("invalid cost identity, revision or basis")
        if self.amount_inr is not None and decimal(self.amount_inr) < 0:
            raise ValueError("negative cost")


def reconcile_costs(lines: tuple[CostLine, ...]) -> tuple[CostLine, ...]:
    """An actual total replaces its matching planned line; revisions replace events.

    The platform supplies accumulated actual category/line totals, not individual
    expense increments. Reusing an event ID with changed content is an error.
    """
    events: dict[str, CostLine] = {}
    selected: dict[str, CostLine] = {}
    for line in lines:
        if line.event_id:
            if line.event_id in events and events[line.event_id] != line:
                raise ValueError("conflicting duplicate cost event")
            events[line.event_id] = line
        old = selected.get(line.key)
        rank = (line.basis == "actual", line.revision)
        if (
            old is not None
            and rank == (old.basis == "actual", old.revision)
            and old.amount_inr != line.amount_inr
        ):
            raise ValueError("conflicting cost revision")
        if old is None or rank > (old.basis == "actual", old.revision):
            selected[line.key] = line
    return tuple(selected[key] for key in sorted(selected))


def crop_budget(
    *,
    yield_kg_ha: MoneyInput | None,
    area_ha: MoneyInput,
    price_inr_kg: MoneyInput | None,
    costs: tuple[CostLine, ...],
    costs_complete: bool,
    product_form: str,
    price_product_form: str,
    cost_basis: Literal["cash", "full_economic"] = "cash",
    byproduct_revenue_inr: MoneyInput = 0,
) -> dict:
    if product_form != price_product_form:
        raise ValueError("crop product form and price product form differ")
    if cost_basis not in ("cash", "full_economic"):
        raise ValueError("unknown cost basis")
    area, byproduct = decimal(area_ha), decimal(byproduct_revenue_inr)
    if area <= 0 or byproduct < 0:
        raise ValueError("invalid area or byproduct revenue")
    amount = None if yield_kg_ha is None else decimal(yield_kg_ha) * area
    price = None if price_inr_kg is None else decimal(price_inr_kg)
    if (amount is not None and amount < 0) or (price is not None and price < 0):
        raise ValueError("negative yield or price")
    ledger = reconcile_costs(costs)
    complete = costs_complete and all(line.amount_inr is not None for line in ledger)
    total = (
        sum(
            (decimal(line.amount_inr) for line in ledger if line.amount_inr is not None), Decimal(0)
        )
        if complete
        else None
    )
    revenue = None if amount is None or price is None else amount * price + byproduct
    profit = None if revenue is None or total is None else revenue - total
    roi = None if profit is None or total is None or total <= 0 else 100 * profit / total
    breakeven = (
        None
        if total is None or amount is None or amount <= 0
        else max(Decimal(0), total - byproduct) / amount
    )
    results = {
        "revenue_inr": revenue,
        "cost_inr": total,
        "net_profit_inr": profit,
        "roi_percent": roi,
        "break_even_price_inr_kg": breakeven,
    }
    return {
        **{key: None if value is None else money(value) for key, value in results.items()},
        "cost_basis": cost_basis,
        "costs_complete": complete,
        "product_form": product_form,
        "incremental_value_inr": None,
        "incremental_value_reason": "product_response_evidence_required",
    }


def incremental_value(
    *,
    timed_yield_kg: MoneyInput,
    comparator_yield_kg: MoneyInput,
    price_inr_kg: MoneyInput,
    timed_cost_inr: MoneyInput,
    comparator_cost_inr: MoneyInput,
    comparator: str,
) -> dict:
    if not comparator.strip():
        raise ValueError("named comparator required")
    values = [
        decimal(v)
        for v in (
            timed_yield_kg,
            comparator_yield_kg,
            price_inr_kg,
            timed_cost_inr,
            comparator_cost_inr,
        )
    ]
    if min(values) < 0:
        raise ValueError("negative physical or cost input")
    yt, yc, price, ct, cc = values
    return {
        "value_inr": money((yt - yc) * price - (ct - cc)),
        "comparator": comparator,
        "basis": "user_entered_scenario",
    }


@dataclass(frozen=True)
class EconomicScenario:
    sample_id: str
    yield_kg_ha: Decimal
    price_inr_kg: Decimal
    cost_inr_ha: Decimal

    def __post_init__(self) -> None:
        if not self.sample_id or any(
            decimal(x) < 0 for x in (self.yield_kg_ha, self.price_inr_kg, self.cost_inr_ha)
        ):
            raise ValueError("invalid paired scenario")


def quantile(values: list[float], probability: float) -> float:
    if not values or not 0 <= probability <= 1:
        raise ValueError("quantile requires samples and bounded probability")
    ordered = sorted(values)
    index = (len(ordered) - 1) * probability
    lo = int(index)
    return ordered[lo] + (ordered[min(lo + 1, len(ordered) - 1)] - ordered[lo]) * (index - lo)


def scenario_distribution(
    samples: tuple[EconomicScenario, ...],
    *,
    area_ha: MoneyInput,
    draws: int = 2000,
    seed: int = 2026,
) -> dict:
    if not 2000 <= draws <= 10000:
        raise ValueError("draw count must be 2000–10000")
    if not samples:
        return {
            "p10": None,
            "p50": None,
            "p90": None,
            "reason": "yield_price_cost_scenarios_missing",
            "basis": "scenario",
        }
    if len({row.sample_id for row in samples}) != len(samples):
        raise ValueError("duplicate scenario identity")
    area = decimal(area_ha)
    if area <= 0:
        raise ValueError("area must be positive")
    # Keep paired yield/price/cost dependencies; never draw each column separately.
    rows = sorted(samples, key=lambda row: row.sample_id)
    outcomes = [
        float((row.yield_kg_ha * row.price_inr_kg - row.cost_inr_ha) * area) for row in rows
    ]
    rng = Random(seed)
    profits = [outcomes[rng.randrange(len(outcomes))] for _ in range(draws)]
    return {
        "p10": quantile(profits, 0.1),
        "p50": quantile(profits, 0.5),
        "p90": quantile(profits, 0.9),
        "unit": "INR",
        "basis": "scenario",
        "probability_of_loss": None,
        "assumptions": [
            "paired_rows_resampled_with_equal_weight",
            "not_calibrated_prediction_intervals",
        ],
        "sample_size": len(rows),
        "draws": draws,
        "seed": seed,
    }
