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
