# AgriSense — progress

Single consolidated status across all three phases. Per-phase detail stays in
`workstreams/phase-{1,2,3}/`.

Last updated: 2026-09-10.

Live: frontend `agrisense.spacesdrive.cc` (Cloudflare, static export), API and
worker on Cloud Run in GCP project `iitm02`, PostgreSQL on Cloud SQL, media in
GCS, crop-vision model on Cloud Run.

---

## Where each phase stands

| Phase | State |
|---|---|
| Phase 3 — platform | **Complete.** 59 contract routes, auth, multi-tenancy, outbox, jobs, media, assistant, WhatsApp, deployment. 222 backend tests pass |
| Phase 1 — farmer experience | **9 of 11 requirements done.** P1-10 and P1-04 outstanding |
| Phase 2 — science | **Code complete; reference data partly supplied.** Water figures are now real. Crop ranking, spray certification and economics remain honestly unavailable |

---

## Phase 1 — farmer experience

| Req | State | Notes |
|---|---|---|
| P1-01 auth | done | verified live, including cross-account denial |
| P1-02 onboarding | done | location, land, consent, draft persistence, season budget |
| P1-03 crop selection | done | ranked cards, compatibility/water/ROI/harvest meters, sorts, comparison table, exclusions named per crop. Now also shown *inside* onboarding |
| P1-04 dashboard | **partial** | has field switch, recommendation, data requests, per-field delete. Missing: water plan, live profit and weather/risk strip folded into the summary |
| P1-05 readiness & fit | done | window first, need/timing/viability split, stress projection by type, safety checks, onsets, product fit, freshness |
| P1-06 live ROI & water | done | ROI distribution, spend-to-date vs remaining, what-if, water screen in mm and litres |
| P1-07 journal | done | timeline, filters, entry form, photos through preprocessing → vision → Gemini |
| P1-08 ask | done | text, voice in five languages, photos, proposals with confirmation |
| P1-09 notifications & plan | done | seven-day grouping, reminders, quiet hours |
| P1-10 end season | **missing** | closure flow, harvest and sales entry, forecast-vs-actual review |
| P1-11 agronomist | done | server-gated, no client role |

### Fixed this session

- **Crop comparison could never have worked.** `PlanningRequest` requires
  `available_water_m3` and `budget_inr`; neither appeared anywhere in the
  frontend, so the engine excluded every candidate for a missing budget. That
  would have kept looking like a Phase 2 data gap after the data landed.
  Onboarding now asks for both and both travel with the field.
- **Data-request pills linked to `/onboarding`**, which starts a *new* field, so
  tapping "say how you water this field" could never satisfy the request. Those
  values are now edited in place against the field, with its version.
- Premature success notice in onboarding: "Wheat is set for this field" appeared
  the instant a crop was tapped, before any request had been made.
- Mobile clip where the stress-curve caption inherited the chart scroller's
  minimum width.
- Three `?? []` memo inputs that produced a new array identity per render.

---

## Phase 2 — science

Code was already complete. The blocker was an empty `parameters` map, which made
every reviewed lookup fail.

**Water requirement is now real.** `science/reference/parameters.json` carries
crop coefficients, rooting depths and depletion fractions transcribed from three
retrieved FAO publications, with the URL and the transcription limits travelling
with each record as evidence. Nothing was recalled from memory — a misremembered
crop coefficient produces wrong irrigation advice silently, which is the
highest-stakes error this app can make.

Assumptions are recorded on every record rather than hidden: `kc` is `Kc_mid`;
rooting depth is the midpoint of the printed range; a medium loam is assumed
because field texture is collected nowhere; `efficiency` is 1.0, so the figure is
a **net** requirement and a farmer on flood irrigation needs materially more at
the pump; rice is an upland balance, not a paddy model. See
`science/reference/PARAMETERS.md`.

**Crop ranking is still unavailable, deliberately.** It additionally needs
district sowing calendars, seasonal irrigation requirements and cost of
cultivation. Those are region- and season-specific and were not guessed. The
loader, record schema and validation are complete and tested, so a reviewed
calendar drops in without code changes.

### Needs a human, and why

| Missing | Why it cannot be inferred |
|---|---|
| District crop calendars, seasonal irrigation, cost of cultivation | Region- and season-specific; from a state agriculture department or CACP returns |
| Product label constraints | Regulatory. Legal rates, pre-harvest intervals and crop/stage permissions differ by product and country |
| `farmer_advice_approved` | An agronomist sign-off, not a code change. Stays `false` |
| Paired yield/price/cost rows | Real observed outcomes. Economics correctly returns unknown without them |

---

## Phase 3 — platform

Complete. Detail in `workstreams/phase-3/progress.md`. Notable decisions:
contract-driven dispatch from `contracts/`, composite-key tenant isolation,
optimistic concurrency, idempotency ledger, transactional outbox with
per-consumer receipts, durable job leasing, keyset pagination, DB-backed rate
limits, IAM signBlob for media URLs.

---

## Deployment

| Component | Where | State |
|---|---|---|
| Frontend | Cloudflare Workers Static Assets | **Blocked on an operator.** `wrangler deploy` needs `CLOUDFLARE_API_TOKEN`, which is not in this environment. Build and its pre-upload checks pass |
| API | Cloud Run `agrisense-api` | deployed |
| Worker | Cloud Run Job | deployed |
| Vision model | Cloud Run `agrisense-vision`, private | deployed, 38 PlantVillage classes |
| Database | Cloud SQL PostgreSQL | live |

`scripts/deploy/web-cloudflare.sh` takes every value from the environment and
refuses to upload a bundle containing a localhost API base.

---

## Verification

- Backend: 222 tests pass.
- Web: 108 unit tests pass; typecheck and lint clean, zero warnings.
- Contracts: `scripts/generate_contracts.py --check` passes.
- Live: evaluation verified end to end against real Meteoblue data (33 stress
  points across three types). Voice verified in five languages. Photo chain
  verified through preprocessing → Cloud Run vision → Gemini.

---

## Next

1. P1-10 — end season, harvest and sales entry, forecast-vs-actual review.
2. P1-04 — fold water plan, live profit and the weather/risk strip into the
   dashboard.
3. Full end-to-end pass over every screen.
