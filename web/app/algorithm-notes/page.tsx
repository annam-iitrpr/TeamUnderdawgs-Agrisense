"use client";

import { DashboardShell } from "@/components/dashboard-shell";
import { Card } from "@/components/ui";

type Note = {
  n: number;
  title: string;
  quote: string;
  page: string;
  issue: string;
  decision: string;
  flag: string;
};

const NOTES: Note[] = [
  {
    n: 1,
    title: "The drought index risk bands are contradictory",
    page: "page 5",
    quote:
      "Interpretation of the Drought Index (DI): DI > 1: No risk. DI = 1: Medum risk. DI < 1: Medum risk.",
    issue:
      "Two of the three bands are labelled medium and no high risk band is defined, so the scale cannot separate a dry season from a catastrophic one. The index is also unnormalised, so its magnitude scales with the length of the accumulation window and no fixed threshold can mean anything.",
    decision:
      "Implement the raw equation exactly as written, including the document's operator precedence. Alongside it, rank that raw value against the same grid cell's history for the same calendar window and return a 0 to 9 score on the same scale as every other stress. The percentile is what the interface shows. The raw value stays in the API response for audit.",
    flag: "DROUGHT_INDEX_SURFACE_PERCENTILE",
  },
  {
    n: 2,
    title: "The nighttime worked example is a copy of the daytime one",
    page: "page 3",
    quote: "Diurnal Night stress for soyabean = 9*[(TMAX - 32) / (45- 32)]",
    issue:
      "The nighttime equation is stated correctly a few lines above using TMIN and the TMin table. The worked example that follows uses TMAX and the soybean daytime cardinals of 32 and 45. Following the example would compute daytime stress twice and never detect a warm night at all. Warm nights are the stress most likely to be missed, because the crop looks fine during the day.",
    decision:
      "Implement the stated equation with TMIN and the TMin table, capped at 9 as the document instructs.",
    flag: "NIGHT_STRESS_USE_DAYTIME_EXAMPLE, default False",
  },
  {
    n: 3,
    title: "The phosphorus soil factor divides three factors by four",
    page: "page 8",
    quote: "SF = (pHf + SMf + RFf) / 4",
    issue:
      "Three factors are summed, each scored 0 to 1, and the sum is divided by four. A field with perfect pH, perfect soil moisture and perfect rainfall scores 0.75. The soil factor can never reach 1, so phosphorus use efficiency is systematically understated by a quarter.",
    decision:
      "Divide by three by default, so optimal conditions produce a soil factor of 1.0 and the efficiency bands on the same page line up with reality.",
    flag: "PHOSPHORUS_SF_DIVISOR, default 3.0",
  },
  {
    n: 4,
    title: "Frost is recorded as NA for rice and wheat",
    page: "page 3",
    quote: "Rice: NA, NA.  Wheat: NA, NA.",
    issue:
      "Returning zero for a stress that is not applicable is a factual error with a real consequence. Zero means we checked and there is no frost risk. NA means this crop is not assessed for frost. A farmer who sees a zero draws a conclusion the model never supported.",
    decision:
      "Return no value at all, with an applicability flag and a note. The interface renders it as not applicable for this crop, never as a number and never as a green square. The need calculation excludes non applicable stresses rather than treating them as zero.",
    flag: "None. There is no defensible reading in which NA means zero.",
  },
  {
    n: 5,
    title: "Yield risk sums unnormalised squared deviations",
    page: "page 5",
    quote:
      "YR = w1*(GDD - GDD_opt)^2 + w2*(P - Popt)^2 + w3*(pH - pHopt)^2 + w4*(N - Nopt)^2",
    issue:
      "The four terms sit on wildly different numeric scales. A GDD deviation of 500 degree days is ordinary and a pH deviation of 1.0 is large, but squaring gives 250000 against 1.0, and after weighting, 75000 against 0.2. The GDD term is roughly 375000 times the pH term, so w3 and w4 have no influence at all. The stated intent, that pH and nitrogen matter slightly less, is not what the formula does.",
    decision:
      "Min-max normalise each deviation against that crop's own optimal range before squaring and weighting, then map the result onto the same 0 to 9 scale as the other stresses. The weights then mean what the document says they mean. A unit test demonstrates the difference numerically.",
    flag: "YIELD_RISK_NORMALISE, default True",
  },
];

const OURS = [
  [
    "GDD base temperatures",
    "Page 6 defines the GDD equation and describes Tbase but never tabulates it. We use conventional published values: wheat 0 C, rice 10 C, cotton 15.6 C. Without a base temperature there is no phenology at all, so this is the one gap we had to fill to ship.",
  ],
  [
    "Growth stage boundaries",
    "The document gives season total GDD optima but no stage splits. Ours are proportional divisions of those totals, used only to decide whether a product applies.",
  ],
  [
    "Spray viability thresholds",
    "Delta T ideal band 2 to 8 with a hard rejection above 10, wind between 3 and 15 km/h, four rain free hours required. Standard published spray thresholds, not Syngenta figures.",
  ],
  [
    "Delta T scored on a plateau",
    "Scoring by distance from the band centre treats a humid dawn at Delta T 2 as equally poor as a hot afternoon at 8, and in testing it ranked a 2pm window above a dawn one. The score is flat across 2 to 5 and falls away at both ends.",
  ],
  [
    "Early morning preferred for uptake",
    "Delta T, wind and rain describe whether the droplet reaches the leaf. They say nothing about whether the plant absorbs it. Morning carries the highest weighting because the crop is turgid and stomata are open.",
  ],
  [
    "Applying during an ongoing stress",
    "When a stress has already started there is no lead time left. Since the document describes Stress Buster as letting the plant tolerate and quickly overcome stress, we still offer the earliest days with the timing fit capped at 0.45, so the score stays honest about the crop not having been protected in advance.",
  ],
  [
    "Yield risk is seasonal, not daily",
    "It compares accumulated GDD and rainfall against whole season optima, so running it over a fourteen day window produces a large deviation on every field regardless of real risk. It is computed once and informs product choice, never spray timing.",
  ],
];

export default function AlgorithmNotesPage() {
  return (
    <DashboardShell
      title="Algorithm implementation notes"
      subtitle="Five points in the Syngenta algorithm document need a stated decision before they can be implemented. Each is recorded here with the decision and the flag that reverses it."
    >
      <div className="space-y-5">
        <Card className="p-4">
          <p className="max-w-[74ch] text-sm text-slate">
            Nothing here is a criticism of the source. These are the places where a
            document written for a human reader has to be made precise enough for a
            machine. Every decision below is reversible through a named flag in{" "}
            <code className="rounded bg-mist px-1 py-0.5 text-xs">
              backend/agrisense/agronomy/constants.py
            </code>
            , so both behaviours stay reproducible.
          </p>
        </Card>

        {NOTES.map((note) => (
          <Card key={note.n} as="article" className="p-5">
            <div className="flex items-baseline gap-3">
              <span className="score-value text-h2 font-semibold text-navy">
                {note.n}
              </span>
              <h2 className="text-h2 font-semibold tracking-tight">{note.title}</h2>
            </div>

            <figure className="mt-3">
              <blockquote className="rounded-control bg-[color-mix(in_srgb,var(--mist)_45%,transparent)] p-3 text-sm italic">
                {note.quote}
              </blockquote>
              <figcaption className="mt-1 text-xs text-slate">
                algorithm_logic.pdf, {note.page}
              </figcaption>
            </figure>

            <dl className="mt-4 space-y-3 text-sm">
              <div>
                <dt className="font-semibold">The issue</dt>
                <dd className="mt-0.5 max-w-[78ch] text-slate">{note.issue}</dd>
              </div>
              <div>
                <dt className="font-semibold">The decision</dt>
                <dd className="mt-0.5 max-w-[78ch] text-slate">{note.decision}</dd>
              </div>
              <div>
                <dt className="font-semibold">The flag that reverses it</dt>
                <dd className="mt-0.5">
                  <code className="rounded bg-mist px-1.5 py-0.5 text-xs">
                    {note.flag}
                  </code>
                </dd>
              </div>
            </dl>
          </Card>
        ))}

        <Card as="section" className="p-5">
          <h2 className="text-h2 font-semibold tracking-tight">
            Decisions that are ours, not the document&apos;s
          </h2>
          <p className="mt-1 max-w-[74ch] text-sm text-slate">
            The document covers stress scoring. It says nothing about when to apply a
            product or under what conditions to spray. Everything below is our own and
            is flagged in the code with{" "}
            <code className="rounded bg-mist px-1 py-0.5 text-xs">
              SOURCE: NOT IN DOCUMENT
            </code>{" "}
            so a reviewer can challenge any one of them.
          </p>
          <dl className="mt-4 space-y-3 text-sm">
            {OURS.map(([title, body]) => (
              <div key={title} className="border-b border-mist pb-3 last:border-0 last:pb-0">
                <dt className="font-semibold">{title}</dt>
                <dd className="mt-0.5 max-w-[78ch] text-slate">{body}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
    </DashboardShell>
  );
}
