# Reference parameters: what is sourced, what is assumed, what is missing

`reference_bundle()` returns an empty `parameters` map unless these files supply
records. An empty map is why `/planning/compare` excludes every crop and
`/seasons/{id}/water` returns `reviewed_water_parameters_required`.

Nothing here is invented. Every number was retrieved from a named publication on
2026-09-10 and transcribed; the URL and the transcription limits travel with the
record as an `EvidenceRecord`.

## `parameters.json` — crop water requirement, populated

Sourced from three retrieved FAO publications:

| Quantity | Source | Retrieved from |
|---|---|---|
| `kc` | FAO-56 Table 12, single crop coefficients | <https://www.fao.org/4/x0490e/x0490e0b.htm> |
| `root_depth_m`, `depletion_fraction` | FAO-56 Table 22 | <https://www.fao.org/4/x0490e/x0490e0e.htm> |
| `field_capacity` − `wilting_point` | FAO Irrigation Water Management Manual 1, §2.4 | <https://www.fao.org/4/r4082e/r4082e03.htm> |

Decisions that are **assumptions, not sources**, and are recorded on every
record so they surface rather than hide:

- **`kc` is `Kc_mid`.** A single seasonal coefficient cannot represent the
  initial and late stages. Where Table 12 prints a range the midpoint is used
  and both bounds are kept in `kc_mid_low` / `kc_mid_high`. The low bound suits
  sub-humid, low-wind conditions and the high bound arid, windy ones; the
  midpoint is not tuned to any district.
- **Rooting depth is the midpoint of the printed range.** Real depth is limited
  by hardpan, water table and tillage depth. None of those is collected.
- **A medium-textured loam is assumed for every field**, because field texture is
  collected nowhere in the product. Only the *difference* between
  `field_capacity` and `wilting_point` is sourced — it equals the published loam
  midpoint of 137.5 mm/m. Total available water, which drives the balance,
  depends only on that difference. The absolute `field_capacity` is a
  texture-typical split and is used only on the rarer path where a same-day
  volumetric soil moisture reading exists.
- **`efficiency` is 1.0, meaning the figure is a _net_ irrigation
  requirement.** Conveyance and application losses are not known per field, so
  no gross figure is claimed. A farmer on flood irrigation will need materially
  more water at the pump than this number.
- **Rice is not a paddy model.** `depletion_fraction` 0.20 describes a saturated
  root zone. Standing-water depth, percolation and puddling losses are absent,
  so a flooded-paddy total is understated. Phase 2's roadmap already lists the
  paddy/AWD model as outstanding.

An `efficiency` below 1.0, a real soil texture, and a paddy model are the three
improvements that would most change these numbers.

## `crop-calendar.json` — crop ranking, deliberately empty

`/planning/compare` additionally needs, per crop and per region: a local sowing
window, season duration bounds, a supported pH range, a reviewed seasonal
irrigation requirement and a reviewed cost of cultivation.

**These are not supplied, and were not guessed.** They are district-specific and
season-specific. An approximate sowing window for "northern India" is not a
reviewed calendar, and `seasonal_irrigation_mm` and `planned_cost_inr_ha` per
crop per district must come from a state agriculture department or from CACP
cost-of-cultivation returns. Filling them from recall would produce a crop
ranking that looks authoritative and is not — the exact failure the rest of the
codebase refuses.

The loader, the record schema and its validation are complete and tested, so a
reviewed calendar file drops in without code changes. Until then, planning
honestly reports `reviewed_regional_crop_reference_missing` naming each crop.

## Still requiring a human, and why

| Missing | Why AgriSense cannot supply it |
|---|---|
| District crop calendars, seasonal irrigation, cost of cultivation | Region- and season-specific; must come from a state agriculture department or CACP |
| Product label constraints (`product:<id>`) | Regulatory. Legal application rates, pre-harvest intervals and crop/stage permissions differ by product and country and cannot be inferred |
| `farmer_advice_approved` | An agronomist's sign-off, not a code change. It stays `false` |
| Paired yield/price/cost rows (`scenario:<crop>:<n>`) | Real observed outcomes. Economics correctly returns unknown without them |

Water figures are now real. Crop ranking, spray-window certification and
economics remain honestly unavailable, each naming its own reason.
