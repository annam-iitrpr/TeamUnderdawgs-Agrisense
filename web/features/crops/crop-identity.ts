/**
 * The icon that belongs to a crop id.
 *
 * The ids are the reviewed catalogue's own — the fifteen `planning:<id>`
 * records in `science/reference/crop-calendar.json` that `/catalog/crops`
 * serves. They are repeated here for their ICONS ONLY. Names and the
 * biological-advice flag still come from the API, so this file cannot invent a
 * sixteenth crop or drift from the catalogue's wording: an id it does not know
 * gets a neutral leaf rather than another crop's icon.
 *
 * Lucide has no glyph for most of these crops, so each one is the nearest
 * recognisable thing — a bowl for rice, a shirt for cotton, concentric rings
 * for onion. An icon therefore never stands alone: every screen renders the
 * crop's name beside it, and the icon is there to make one crop findable in a
 * list of several, not to identify it on its own.
 */
import {
  Apple,
  Bean,
  Carrot,
  CircleDot,
  Clover,
  Flower,
  Flower2,
  Leaf,
  Popcorn,
  Shell,
  Shirt,
  Shrub,
  Soup,
  Sprout,
  TreePalm,
  Wheat,
  type LucideIcon,
} from "lucide-react";

const CROP_ICONS = {
  wheat: Wheat,
  rice: Soup,
  maize: Popcorn,
  potato: Carrot,
  sugarcane: TreePalm,
  barley: Shrub,
  field_pea: Bean,
  lentil: Clover,
  sorghum: Flower,
  bajra: Flower2,
  groundnut: Shell,
  onion: CircleDot,
  tomato: Apple,
  moong: Sprout,
  cotton: Shirt,
} as const satisfies Record<string, LucideIcon>;

/** Every crop id the reference bundle defines. Fifteen, and never sixteen. */
export type CatalogueCropId = keyof typeof CROP_ICONS;

export const CATALOGUE_CROP_IDS = Object.keys(CROP_ICONS) as CatalogueCropId[];

/**
 * The icon for a crop id, or a neutral leaf for one this build has never heard
 * of. A crop the catalogue adds later is still listed and still readable — it
 * simply has no icon yet, which is the honest state rather than a borrowed one.
 */
export function cropIcon(cropId: string): LucideIcon {
  return (CROP_ICONS as Record<string, LucideIcon>)[cropId] ?? Leaf;
}
