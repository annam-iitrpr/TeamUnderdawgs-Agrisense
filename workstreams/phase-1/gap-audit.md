# Farmer experience: what is missing, against the PRD and P1-01..P1-11

Audited 2026-09-10 against `PRD-rought.pdf` (user flow, page 3) and
`01-PHASE-1-FARMER-EXPERIENCE.md`. Every backend route these need already exists and is
deployed; the gaps below are screens, not services.

## The PRD user flow, and where it breaks

```
1 Location access          built
2 Land size                built
3 Choose a crop | Suggest one
    |                        \
    4 Input crop + when       4 Top 5 crops              NEITHER BRANCH BUILT
    5 Warnings & requirements   - name
      - needed water            - estimated water, litres + score
      - compatibility score     - compatibility score per crop
      - time to harvest         - ROI
      - warnings                - time to harvest
      - ROI                     - warnings
      - "Suggest one" button    - sowing time min-max
      - multiple crops
                    \        /
                     Dashboard
```

A plain crop picker was built instead: it writes a season but shows no water, no
compatibility, no harvest window, no ROI and no warnings, and offers no ranked suggestions.
That is the substance of the flow, so this is the main gap.

## Gap list

| Req | State | What is missing |
|---|---|---|
| P1-01 auth | done | verified live, incl. cross-account denial |
| P1-02 onboarding | done | location, land size, consent, draft persistence |
| P1-03 crop selection | **missing** | top-five ranked cards, per-crop compatibility/water/ROI/harvest/sowing window/warnings, sort controls, side-by-side comparison, exclusion explanations |
| P1-04 dashboard | partial | has field switch, recommendation, data-request pills. Missing: water plan, live profit, weather/risk strip, "Why this window" |
| P1-05 readiness & fit | **missing** | fourteen-day stress projection, hour selection with blocked-hour reasons, need/timing/viability split, product fit, freshness labels. The pre-contract `/hours` and `/why` screens were deleted because they called routes the API does not serve |
| P1-06 live ROI & water | **missing** | ROI distribution, spend-to-date vs forecast remaining, what-if controls, water screen separating ET, irrigation requirement and total volume, mm and litres |
| P1-07 journal | done | timeline, filters, entry form, photos |
| P1-08 ask | done | text, voice in five languages, photos, proposals with confirmation |
| P1-09 notifications & plan | done | seven-day grouping, reminders, quiet hours |
| P1-10 end season | **missing** | closure flow, harvest and sales entry, forecast-vs-actual review |
| P1-11 agronomist | done | server-gated, no client role |

## Order of work

1. **P1-03** — the flow the PRD leads with, and the one that makes a crop choice meaningful.
2. **P1-06** — ROI and water, which P1-03's cards summarise and this screen explains.
3. **P1-05** — readiness, hours and why, replacing the deleted screens.
4. **P1-10** — end season and prediction review.
5. **P1-04** — fold the above into the dashboard's summary cards.

## Constraint that shapes all of it

`/planning/compare` and `/seasons/{id}/evaluate` return real weather and real stress, and
`insufficient_data` for advice, because Phase 2's reviewed `parameters` map is empty. Every
screen below therefore has to render an honest unknown per field rather than a zero, and fill
in automatically when that data lands. A zero water requirement or a zero ROI would be a
fabricated claim, not a blank state.
