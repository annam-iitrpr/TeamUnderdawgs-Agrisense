import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CATALOGUE_CROP_IDS, cropIcon } from "@/features/crops/crop-identity";

/**
 * The icon map repeats the catalogue's crop ids, so it can drift from it.
 * These read the reference bundle itself rather than a copy, so adding a crop
 * to the catalogue without giving it an icon fails here instead of shipping a
 * screen where one crop silently wears a neutral leaf.
 */
const calendar = JSON.parse(
  readFileSync(resolve(__dirname, "../../../science/reference/crop-calendar.json"), "utf8"),
);

/**
 * The bundle keys its crops as `planning:<id>`; the app uses the bare id.
 *
 * Only the `planning:` records name a crop. The same map also holds
 * `economics:<id>` and `scenario:<id>:<case>` rows, and counting those made the
 * catalogue look five times longer than it is.
 */
function catalogueIds(): string[] {
  return Object.keys(calendar.parameters)
    .filter((key) => key.startsWith("planning:"))
    .map((key) => key.slice("planning:".length));
}

describe("crop identity", () => {
  it("covers exactly the crops the reference bundle defines", () => {
    expect([...CATALOGUE_CROP_IDS].sort()).toEqual([...catalogueIds()].sort());
  });

  it("defines fifteen crops, and never a sixteenth", () => {
    expect(CATALOGUE_CROP_IDS).toHaveLength(15);
  });

  it("gives an unknown crop a neutral icon rather than another crop's", () => {
    const unknown = cropIcon("dragonfruit");
    for (const id of CATALOGUE_CROP_IDS) {
      if (id !== "moong") expect(cropIcon(id)).not.toBe(unknown);
    }
  });
});
