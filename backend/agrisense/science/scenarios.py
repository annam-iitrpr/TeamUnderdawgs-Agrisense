"""Vectorized, paired crop-budget scenarios served through the v1 extension map."""

from datetime import date

import numpy as np

from agrisense.contracts_generated import models as api

from .contract_bridge import estimate, measurement
from .references import number, reviewed_parameters


def economic_estimates(
    crop_id: str,
    area_ha: float,
    references: api.ReferenceBundle,
    as_of: date,
    *,
    has_actual_ledger: bool = False,
    actual_cost_inr: float | None = None,
    draws: int = 2000,
    seed: int = 2026,
) -> api.Economics:
    if not 2000 <= draws <= 10000 or area_ha <= 0:
        raise ValueError("invalid bounded scenario request")
    reason = "paired_yield_price_cost_scenarios_and_cost_completeness_required"
    missing = api.Economics(
        cost=estimate(None, "INR", "whole_season_cost", reason),
        revenue=estimate(None, "INR", "whole_season_revenue", reason),
        profit=estimate(None, "INR", "whole_season_profit", reason),
        roi=estimate(None, "%", "whole_season_roi", reason),
        price=measurement(None, "INR/kg", "dated_product_form_price_required"),
    )
    # A farmer who has started recording is the one with most to lose from a blank
    # screen, and was exactly who got one: a single ledger line suppressed cost,
    # revenue, profit and return together. Having a ledger no longer hides the
    # season estimate.
    #
    # The estimate stays whole-season on both sides, though. Spend recorded so far
    # is not the season's cost -- a maize grower nine weeks in has paid for seed
    # and two urea splits and nothing else -- and dividing a whole season's
    # revenue by a part season's spend produced a return of 957 percent. What has
    # been spent to date is a real and useful figure, but it belongs beside this
    # one and not inside it.
    config = reviewed_parameters(references, f"economics:{crop_id}", as_of)
    if (
        not config
        or config.get("costs_complete") is not True
        or config.get("cost_basis") not in ("cash", "full_economic")
    ):
        return missing
    product_form = config.get("product_form")
    if not product_form or config.get("price_product_form") != product_form:
        return missing
    samples, evidence_ids = [], set()
    for key in sorted(references.parameters):
        if not key.startswith(f"scenario:{crop_id}:"):
            continue
        record = reviewed_parameters(references, key, as_of)
        if (
            not record
            or record.get("product_form") != product_form
            or record.get("cost_basis") != config["cost_basis"]
        ):
            continue
        try:
            samples.append(
                [
                    number(record, "yield_kg_ha", low=0),
                    number(record, "price_inr_kg", low=0),
                    number(record, "cost_inr_ha", low=0),
                ]
            )
            evidence_ids.add(str(record["evidence_id"]))
        except (KeyError, ValueError, TypeError):
            return missing
    if not samples:
        return missing
    data = np.asarray(samples, dtype=np.float64)
    rng = np.random.default_rng(seed)
    paired = data[rng.integers(0, len(data), draws)]
    revenue = paired[:, 0] * paired[:, 1] * area_ha
    observed_cost = False
    cost = paired[:, 2] * area_ha
    profit = revenue - cost
    if (
        not np.isfinite(revenue).all()
        or not np.isfinite(cost).all()
        or not np.isfinite(profit).all()
    ):
        raise ValueError("scenario arithmetic overflow")
    assumptions = [
        "paired_rows_equal_weight_resampling",
        "scenario_not_calibrated_interval",
        f"cost_basis:{config['cost_basis']}",
        f"product_form:{product_form}",
        f"draws:{draws}",
        f"seed:{seed}",
        f"source_samples:{len(samples)}",
    ]

    if observed_cost:
        assumptions = [*assumptions, "cost_is_the_farmers_own_recorded_spend"]

    def distribution(values: np.ndarray, unit: str, target: str, *, basis: str = "scenario") -> api.Estimate:
        low, middle, high = np.quantile(values, [0.1, 0.5, 0.9])
        return api.Estimate(
            p10=float(low),
            p50=float(middle),
            p90=float(high),
            unit=unit,
            basis=basis,
            target=target,
            assumptions=assumptions,
            evidence_ids=sorted(evidence_ids),
            input_completeness=1,
        )

    roi = (
        estimate(None, "%", "whole_season_roi", "zero_cost_in_scenarios")
        if np.any(cost <= 0)
        else distribution(100 * profit / cost, "%", "whole_season_roi")
    )
    return api.Economics(
        # Observed when it is the farmer's own ledger, scenario when it is ours.
        # Blurring the two would be the one thing this whole module exists to avoid.
        cost=distribution(
            cost, "INR", "whole_season_cost", basis="observed" if observed_cost else "scenario"
        ),
        revenue=distribution(revenue, "INR", "whole_season_revenue"),
        profit=distribution(profit, "INR", "whole_season_profit"),
        roi=roi,
        price=measurement(
            None, "INR/kg", "harvest_price_is_scenario_distribution_not_current_quote"
        ),
    )
