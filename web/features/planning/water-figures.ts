/**
 * Water, in the two units a farmer actually thinks in.
 *
 * The engine works in millimetres, which is depth over an area and therefore
 * independent of field size. Litres are not: they scale with the area, so the
 * conversion has to be done against the area actually allocated. One millimetre
 * over one hectare is ten thousand litres.
 *
 * Per-hectare figures must never be rescaled by area — doing so would double
 * count. Only totals scale.
 */
export const LITRES_PER_MM_PER_HECTARE = 10_000;

export function litresForArea(mm: number, hectares: number): number {
  return mm * LITRES_PER_MM_PER_HECTARE * hectares;
}

/** Litres get large fast, so they are shown at a scale a person can read. */
export function formatLitres(litres: number): string {
  if (litres >= 1_000_000) return `${(litres / 1_000_000).toFixed(litres >= 10_000_000 ? 0 : 1)} million L`;
  if (litres >= 1_000) return `${Math.round(litres / 1_000).toLocaleString("en-IN")} thousand L`;
  return `${Math.round(litres).toLocaleString("en-IN")} L`;
}

/**
 * A comparative water score across the candidates being shown.
 *
 * This is deliberately relative and labelled as such: there is no reviewed
 * absolute threshold for "a lot of water", so inventing one would be a claim the
 * engine never made. Least thirsty of the set scores 1.
 */
export function relativeWaterScore(mm: number | null, allMm: readonly (number | null)[]): number | null {
  if (mm == null) return null;
  const known = allMm.filter((v): v is number => v != null && v > 0);
  if (known.length < 2) return null;
  const lowest = Math.min(...known);
  const highest = Math.max(...known);
  if (highest === lowest) return 1;
  return 1 - (mm - lowest) / (highest - lowest);
}

/**
 * Litres from whatever unit the contract actually used.
 *
 * The engine does not speak one unit for water. A seasonal estimate arrives in
 * cubic metres, a per-day replenishment figure arrives already in litres for the
 * allocated area, and a crop reference is in millimetres of depth. Only the
 * millimetre form scales with area.
 *
 * This exists because the water screen assumed millimetres everywhere and so
 * printed two different numbers for the same figure: a value already in litres
 * was labelled "L" and then re-run through the millimetre conversion, and a
 * cubic-metre seasonal total was multiplied by ten thousand as though it were a
 * depth. Returning null for an unrecognised unit is deliberate — showing a
 * number in the wrong unit is worse than showing no number.
 */
export function litresFromMeasurement(
  value: number | null | undefined,
  unit: string | null | undefined,
  hectares: number,
): number | null {
  if (value == null || unit == null) return null;
  switch (unit) {
    case "L":
      // Already a volume for the area the engine was given. Scaling it again
      // would multiply by the area twice.
      return value;
    case "m³":
    case "m3":
      return value * 1000;
    case "mm":
      // A depth, so it only becomes a volume against an area.
      return litresForArea(value, hectares);
    default:
      return null;
  }
}

/**
 * Splits the engine's `"<date>:<reason>"` marker into its parts.
 *
 * The per-day water figures carry the date and the reason packed into one
 * string. The screen was showing "Day 1", "Day 2" and discarding both, so a
 * farmer could not tell which day was missing or why.
 */
export function splitDayReason(
  packed: string | null | undefined,
): { date: string | null; reason: string | null } {
  if (!packed) return { date: null, reason: null };
  const match = /^(\d{4}-\d{2}-\d{2}):(.*)$/.exec(packed);
  if (!match) return { date: null, reason: packed };
  return { date: match[1] ?? null, reason: match[2] || null };
}
