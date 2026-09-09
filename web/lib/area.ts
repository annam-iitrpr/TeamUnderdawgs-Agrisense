/**
 * Area entry and normalisation.
 *
 * The contract stores `area_ha` alongside the farmer's original
 * `entered_area` + `entered_area_unit`, and both matter. A silent unit error
 * here scales every irrigation volume and every rupee figure for the whole
 * season, so onboarding echoes the normalised value back and keeps the original
 * exactly as typed.
 */
import type { AreaUnit } from "./api/contract";

/**
 * Hectares per unit.
 *
 * `kanal` is regionally ambiguous and this is a genuine agronomic caveat, not a
 * rounding choice. The Punjab/Haryana kanal is 5,445 sq ft (505.857 m²), which
 * is what the pilot geography uses. Elsewhere in India a kanal of 4,500 sq ft
 * is used, which is ~17% smaller. The value below is the Punjab one; a farmer
 * outside that belt entering "kanal" would be misread, which is why the UI
 * shows the converted hectare figure back for confirmation rather than
 * accepting the unit silently.
 *
 * Flagged for mentor confirmation — see workstreams/phase-1/decisions.md D-008.
 */
const HECTARES_PER_UNIT: Record<AreaUnit, number> = {
  ha: 1,
  acre: 0.404_685_642_2,
  sqm: 0.000_1,
  kanal: 0.050_585_7,
};

export const AREA_UNITS: readonly AreaUnit[] = ["acre", "ha", "kanal", "sqm"];

/** Units whose definition is regionally contested, so the UI can say so. */
export const AMBIGUOUS_UNITS: ReadonlySet<AreaUnit> = new Set<AreaUnit>(["kanal"]);

export function toHectares(value: number, unit: AreaUnit): number {
  return value * HECTARES_PER_UNIT[unit];
}

export function fromHectares(hectares: number, unit: AreaUnit): number {
  return hectares / HECTARES_PER_UNIT[unit];
}

export type AreaParseResult =
  | { ok: true; enteredArea: number; unit: AreaUnit; areaHa: number }
  | { ok: false; reason: "empty" | "not_a_number" | "not_positive" | "implausibly_large" };

/**
 * The largest field this accepts, in hectares.
 *
 * India's average holding is around 1 ha and 86% of holdings are under 2 ha, so
 * a five-figure hectare entry is far more likely to be a typo or a unit slip
 * than a real farm. Rejecting it with an explanation is kinder than scoring a
 * nonsensical field. It is a UX guard, not an agronomic limit.
 */
export const MAX_PLAUSIBLE_HECTARES = 10_000;

export function parseArea(raw: string, unit: AreaUnit): AreaParseResult {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: false, reason: "empty" };

  // Accept a comma as a decimal separator, which several Indian keyboards emit.
  const normalised = trimmed.replace(",", ".");
  if (!/^\d*\.?\d+$/.test(normalised)) return { ok: false, reason: "not_a_number" };

  const value = Number(normalised);
  if (!Number.isFinite(value)) return { ok: false, reason: "not_a_number" };
  if (value <= 0) return { ok: false, reason: "not_positive" };

  const areaHa = toHectares(value, unit);
  if (areaHa > MAX_PLAUSIBLE_HECTARES) return { ok: false, reason: "implausibly_large" };

  return { ok: true, enteredArea: value, unit, areaHa };
}

/**
 * Rounds hectares for transmission.
 *
 * Six decimals is ~1 m² of resolution, which is finer than any farmer-entered
 * boundary, and avoids sending a float artefact like 0.40468564220000004.
 */
export function roundHectares(areaHa: number): number {
  return Math.round(areaHa * 1e6) / 1e6;
}
