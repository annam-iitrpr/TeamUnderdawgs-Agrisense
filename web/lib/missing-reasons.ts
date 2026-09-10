/**
 * Turning the engine's codes into something a farmer can act on.
 *
 * Two vocabularies arrive over the wire and both land on screen: the
 * missing-data codes that say why a figure is absent, and the warnings that
 * qualify a figure that is present. The codes are precise and are the right
 * thing to send, but `initial_storage_unknown` shown verbatim tells a farmer
 * nothing about what to do, and `.replace(/_/g, " ")` only makes it lowercase
 * jargon.
 *
 * Two rules:
 *  - Every phrase says what is missing or what the caveat means, and where
 *    possible who can supply it. "Not known" with no reason is a dead end.
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
  zero_cost_in_scenarios: "cannot be worked out when the scenario cost is zero",
  harvest_price_is_scenario_distribution_not_current_quote:
    "the price inside this scenario is a spread of past sales, not a quote you could sell at today",

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

  // Mandi prices and the support price beside them.
  no_msp_is_declared_for_this_crop:
    "the government does not declare a support price for this crop, so there is no floor under the mandi range",
  current_declared_msp_series_unavailable:
    "the only published support-price list ends at 2022-23, and quoting a four-year-old figure in a sale could lose you money",
  prices_are_reported_arrivals_not_a_forecast:
    "these are the prices mandis reported today, not a prediction of what you will get at harvest",

  // Closure review metrics and their bases.
  actual_margin: "What you actually made",
  actual_roi: "Return on what you actually spent",
  forecast_margin: "What AgriSense forecast you would make",
  margin_error: "Difference between forecast and actual",
  margin_error_percent: "Difference, as a share of the forecast",
  against_forecast_margin: "measured against the forecast",
  zero_forecast_margin: "the forecast was zero, so there is no share to state",

  // Providers.
  provider_value_invalid: "the weather service returned a value that cannot be true",
  no_forecast_provider_available: "no weather service could be reached",

  // Warnings. These qualify a figure that is present, rather than explaining an
  // absent one, and the engine attaches them to every comparison and evaluation.
  ranking_weights_are_project_choices:
    "how much each factor counts towards the ranking is this project's choice, not an agronomist's",
  no_cross_crop_yield_comparison: "these figures do not compare expected yield between crops",
  economics_requires_paired_yield_price_cost_records:
    "money figures need real yield, price and cost records, which nobody has published for these crops yet",
  scenario_not_field_validated: "this projection has not been checked against real fields",
  v1_safety_and_economics_extensions_pending:
    "spray safety and the money detail are not complete in this version",

  // Assumptions. What a figure took for granted in order to exist at all.
  standard_demand_scenario: "the crop is taken to be growing normally, at its standard water demand",
  no_future_irrigation_assumed:
    "no watering is assumed between now and each day shown, so each figure is the most that day could need",
  daily_values_are_replenishment_alternatives_do_not_sum:
    "each day's figure refills the root zone on that day — they are alternatives, so do not add them up",
  same_day_vwc_initialization_when_available:
    "the water already in the soil counts only when the moisture reading was taken today",
  reviewed_regional_scenario: "based on the reviewed figures for your region",
  remaining_field_area_used: "worked out for the part of the field that is still free",
  paired_rows_equal_weight_resampling: "every past record counts equally towards the range",
  paired_rows_resampled_with_equal_weight: "every past record counts equally towards the range",
  scenario_not_calibrated_interval:
    "the high and low figures are the spread of past records, not a calibrated forecast",
  not_calibrated_prediction_intervals:
    "the high and low figures are the spread of past records, not a calibrated forecast",
  fees_already_deducted_do_not_duplicate_in_cost_ledger:
    "market fees are already taken off this price — do not enter them again as a cost",
  binary_feasibility_viability: "an hour is either usable for spraying or it is not; there is no partial score",
  stull_standard_pressure_approximation:
    "Delta T uses standard air pressure, not your field's altitude",

  // Gaps the screen notices for itself.
  //
  // The engine names a reason when it computed something and came up short. It
  // says nothing when a whole field of the contract is simply absent — there is
  // no yield anywhere in `Economics`, and an interval that was never published
  // arrives as `null` with no reason attached. Those blanks used to render as
  // "Not known", which tells a farmer neither what is missing nor who could
  // supply it. The codes below are raised by the UI for exactly those cases and
  // live here with the engine's own so that every blank on screen is phrased in
  // one place and in one voice, rather than as a literal string in a component.
  reviewed_yield_per_hectare_unavailable:
    "no reviewed yield for this crop in your district yet, so there is no expected weight per hectare to show",
  season_return_needs_your_budget_or_recorded_costs:
    "a return for the whole season needs your own figures — add what you can spend on this field, or record your costs as you go, and it will be worked out from them",
  sowing_window_not_published_for_your_area:
    "no reviewed sowing window for your district yet",
  harvest_window_not_published_for_your_area:
    "no reviewed harvest window for your district yet",
  season_length_needs_sowing_and_harvest_windows:
    "needs both the sowing and the harvest window, and one of them is not published yet",
  season_water_requirement_unavailable:
    "needs the season's rainfall and the reference water use for this crop",
  suitability_not_scored_for_this_field:
    "the engine could not score this crop against your field",
  no_mandi_reported_this_crop_today:
    "no mandi reported a usable price for this crop today",
  figure_not_supplied: "the engine did not supply this figure and did not say why",
};

/** What a weather provider's own failure code means, once the provider is named. */
const PROVIDER_PHRASES: Record<string, string> = {
  forecast_not_supported: "does not supply an hourly forecast",
  no_data: "returned no data for your field",
  circuit_open: "is being left alone after repeated failures",
  timeout: "did not answer in time",
  https_required: "was not reachable over a secure connection",
  payload_too_large: "returned more data than can be read",
  invalid_json: "returned a response that could not be read",
  invalid_history_schema: "returned history in a shape that could not be read",
};

/** A farmer-readable phrase for a code, or its spaced form if none is written. */
export function explainMissing(code: string | null | undefined): string | null {
  if (!code) return null;
  // Several codes arrive prefixed with the date they apply to.
  const bare = /^\d{4}-\d{2}-\d{2}:(.*)$/.exec(code)?.[1] ?? code;
  if (bare === "") return null;
  if (PHRASES[bare]) return PHRASES[bare];

  // Codes also arrive as `prefix:value`, and the prefix means different things:
  // a provider attaches its own name (`meteoblue:no_data`), while a scenario
  // attaches its settings (`draws:2000`, `cost_basis:market`). Only the known
  // provider failures get the provider sentence — everything else is a labelled
  // value, and phrasing it as a weather outage would be a lie.
  const prefixed = /^([a-z][a-z0-9_.-]*):(.+)$/.exec(bare);
  if (prefixed) {
    const name = prefixed[1] as string;
    const rest = prefixed[2] as string;
    if (PROVIDER_PHRASES[rest]) return `the ${name} weather service ${PROVIDER_PHRASES[rest]}`;
    if (PHRASES[rest]) return PHRASES[rest];
    return `${name.replace(/_/g, " ")}: ${rest.replace(/_/g, " ")}`;
  }

  return bare.replace(/_/g, " ");
}

/** The same phrase, capitalised, for a code shown on its own in a list. */
export function explainCode(code: string): string {
  const phrase = explainMissing(code) ?? code.replace(/_/g, " ");
  return phrase.replace(/^./, (first) => first.toUpperCase());
}
