/**
 * Turning the engine's missing-data codes into something a farmer can act on.
 *
 * The codes are precise and are the right thing to send over the wire, but
 * `initial_storage_unknown` shown verbatim tells a farmer nothing about what to
 * do, and `.replace(/_/g, " ")` only makes it lowercase jargon.
 *
 * Two rules:
 *  - Every phrase says what is missing, and where possible who can supply it.
 *    "Not known" with no reason is a dead end.
 *  - An unrecognised code falls through to its spaced form rather than being
 *    swallowed. A code nobody has written a phrase for should still reach the
 *    screen, because hiding it would make a real gap invisible.
 */

const PHRASES: Record<string, string> = {
  // Water balance.
  initial_storage_unknown:
    "needs to know how much water is already in the soil, which needs a soil moisture reading taken today",
  reviewed_water_parameters_required: "no reviewed water figures for this crop yet",
  invalid_water_parameters: "the water figures for this crop are not usable",
  seasonal_climate_required: "needs the historical climate for your area",
  rain_or_et0_missing: "the forecast is missing rain or evaporation for that day",
  paddy_management_required:
    "flooded paddy needs a different water model, which is not built yet",
  reference_et0_unavailable_for_daily_water_balance:
    "no evaporation figure was available for your field",

  // Economics.
  paired_yield_price_cost_scenarios_and_cost_completeness_required:
    "needs real yield, price and cost records, which nobody has published for this crop yet",
  dated_product_form_price_required: "no dated market price for this crop and form",
  planned_actual_line_reconciliation_contract_required:
    "your own recorded costs cannot yet be compared line by line with the plan",
  zero_cost: "cannot be worked out when the recorded cost is zero",

  // Advice and planning.
  reviewed_regional_crop_reference_missing:
    "no reviewed crop calendar for your district yet",
  rule_parameters_require_field_validation:
    "the advice rules have not been checked against real fields yet",
  confirmed_product_selection_required: "needs you to say which product you would use",
  historical_climate_required: "needs the historical climate for your area",
  no_unallocated_area: "every part of this field already belongs to a season",
  soil_ph_missing: "needs the pH from a soil test",
  outside_local_sowing_calendar: "outside the sowing window for your area",
  irrigation_budget_missing_or_insufficient:
    "needs to know how much water you can use, or the crop needs more than you have",
  cash_budget_missing_or_insufficient:
    "needs to know your budget, or the crop costs more than that",
  project_assumption_pending_validation: "based on an assumption that has not been checked",
  vintage_economics_forecasts_missing_no_error_claim:
    "the money forecasts issued at the time were not kept, so no accuracy claim is made",

  // Providers.
  provider_value_invalid: "the weather service returned a value that cannot be true",
  no_forecast_provider_available: "no weather service could be reached",
};

/** A farmer-readable phrase for a code, or its spaced form if none is written. */
export function explainMissing(code: string | null | undefined): string | null {
  if (!code) return null;
  // Several codes arrive prefixed with the date they apply to.
  const bare = /^\d{4}-\d{2}-\d{2}:(.*)$/.exec(code)?.[1] ?? code;
  if (bare === "") return null;
  return PHRASES[bare] ?? bare.replace(/_/g, " ");
}
