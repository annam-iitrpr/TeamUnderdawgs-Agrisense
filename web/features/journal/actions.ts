import {
  Bug,
  Droplets,
  Eye,
  FlaskConical,
  Scissors,
  Sprout,
  Wheat,
  type LucideIcon,
} from "lucide-react";
import type { JournalEntry } from "@/lib/api/contract";

/** The seven action types the contract defines. Not a superset, not a subset. */
export type JournalAction = JournalEntry["action"];

export const JOURNAL_ACTIONS: readonly JournalAction[] = [
  "watered",
  "fertilizer_applied",
  "biostimulant_applied",
  "pesticide_applied",
  "weed_removed",
  "observation",
  "harvest",
];

type ActionMeta = {
  label: string;
  icon: LucideIcon;
  /** Prompt shown on the form when this action is selected. */
  hint: string;
  /** Default unit offered for the quantity, where one is obvious. */
  defaultUnit: string | null;
};

/**
 * Labels are plain farm language rather than the contract's snake_case, which
 * is an API detail a farmer should never see. Every action carries an icon as
 * well as text, so the timeline never relies on colour alone.
 */
export const ACTION_META: Record<JournalAction, ActionMeta> = {
  watered: {
    label: "Watered",
    icon: Droplets,
    hint: "How much water, if you know it.",
    defaultUnit: "litre",
  },
  fertilizer_applied: {
    label: "Sprayed fertiliser",
    icon: Sprout,
    hint: "What you applied, and how much.",
    defaultUnit: "kg",
  },
  biostimulant_applied: {
    label: "Sprayed biostimulant",
    icon: FlaskConical,
    hint: "The product and the amount, if you have it to hand.",
    defaultUnit: "litre",
  },
  pesticide_applied: {
    label: "Sprayed pesticide",
    icon: Bug,
    hint: "What you sprayed, and how much.",
    defaultUnit: "litre",
  },
  weed_removed: {
    label: "Removed weeds",
    icon: Scissors,
    hint: "Anything you noticed while weeding.",
    defaultUnit: null,
  },
  observation: {
    label: "Something I noticed",
    icon: Eye,
    hint: "Describe what you saw. This is a note, not a diagnosis.",
    defaultUnit: null,
  },
  harvest: {
    label: "Harvested",
    icon: Wheat,
    hint: "How much you took off the field.",
    defaultUnit: "quintal",
  },
};

export const QUANTITY_UNITS: readonly string[] = [
  "litre",
  "kg",
  "quintal",
  "gram",
  "ml",
  "bag",
];

/**
 * How a stored entry should be presented.
 *
 * The contract field is `observation_quality`, NOT a confirmation state:
 * `unreviewed | confirmed | rejected`. An unreviewed entry is what the farmer
 * said happened and nothing more — it must not be styled as an established
 * fact, and a rejected one must not silently vanish from their own record.
 */
export type EntryStanding = "unreviewed" | "confirmed" | "rejected";

export function standingLabel(quality: EntryStanding): string {
  switch (quality) {
    case "confirmed":
      return "Confirmed";
    case "rejected":
      return "Not accepted";
    default:
      return "As you reported it";
  }
}
