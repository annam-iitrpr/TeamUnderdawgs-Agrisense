/**
 * How much of a field is still free to give to a crop.
 *
 * A field's area cannot be promised twice: two seasons each claiming the whole
 * field would double every water and money estimate derived from them. Adding a
 * crop and editing one share this, so the two can never disagree about what is
 * left — an edit form that offered land the add form did not would walk the
 * farmer straight into the server's own allocation refusal.
 */
import type { Season } from "@/lib/api/contract";

export function freeAreaHa(
  areaHa: number,
  seasons: Season[],
  /** The season being edited, whose own claim is not competing with itself. */
  excludeSeasonId: string | null = null,
): number {
  const allocated = seasons
    .filter((s) => s.status !== "closed" && s.id !== excludeSeasonId)
    .reduce((sum, s) => sum + (s.allocated_area_ha ?? 0), 0);
  const remaining = Math.max(0, Number((areaHa - allocated).toFixed(4)));
  /**
   * What the input can actually hold. Its step is 0.01, and a value off that
   * grid fails the browser's own validation — so offering the free area to four
   * decimals made "Add this crop" refuse to submit with "the nearest valid
   * value is 1.01", for every field whose area is not a round hundredth. A
   * field entered in acres is never one: 2.5 acres is 1.011714 ha.
   *
   * Floored, not rounded, because rounding up offers land the field has not got.
   */
  return Math.floor(remaining * 100) / 100;
}
