# AgriSense implementation plan

This is the handoff document for the next implementation session. It is
intentionally self-contained: read this file, `AGENTS.md`, the contract files,
and the linked WhatsApp guide before changing code.

## Project context

AgriSense is a farmer-facing web/PWA plus a WhatsApp channel for forecast-driven
biological application readiness. The pilot geography is Punjab and Vidarbha;
the core crops are rice, wheat, and cotton. The web design uses a full-width,
responsive, calm agricultural visual language with explicit unknown states and
localized farmer copy.

The backend is FastAPI on Cloud Run in GCP project `iitm02`, with Cloud SQL
PostgreSQL, GCS media custody, Firebase identity, a worker/outbox, and the
Phase 2 science facade. The API base is the Cloud Run service recorded in the
canonical local env file. The deployed frontend is intended to be
`agrisense.spacesdrive.cc`.

Real credentials belong only in `~/Work/agrisense.env`, Secret Manager, or the
team password manager. The repository contains no credential file. The local
WhatsApp relay `.env` now points back to the consolidated file.

## Current contracts and routes

The authority is `contracts/openapi.yaml`, generated Python models under
`backend/agrisense/contracts_generated/`, and generated TypeScript under
`web/lib/generated/api.ts`. All API routes are under `/api/v1`, require a
Firebase bearer ID token, return `{data, meta}` on success and
`{error, request_id}` on failure. POST requests require an `Idempotency-Key`.

Relevant routes for WhatsApp:

| Capability | Route | Use |
|---|---|---|
| Farmer identity | `GET /me`, `PATCH /me` | Profile, language, consent, linked channels |
| Field setup | `POST /fields`, `PATCH /fields/{id}` | Location, area, irrigation, budgets |
| Crop/season | `GET /catalog/crops`, `POST /fields/{id}/seasons`, `PATCH /seasons/{id}` | Onboarding and active field |
| Planning | `GET /catalog/locations`, `POST /planning/compare` | Location lookup and crop comparison |
| Evaluation | `POST /seasons/{id}/evaluate`, `GET /seasons/{id}/recommendations/latest` | Readiness, reasoning, value |
| Forecast/water/money | `GET /seasons/{id}/forecast`, `/water`, `/economics` | Dashboard and WhatsApp summaries |
| Journal | `POST /seasons/{id}/journal`, `GET /seasons/{id}/journal` | Text, photo, voice, action logging |
| Media | `POST /media/uploads`, `POST /media/{id}/complete`, `GET /media/{id}/access` | Custody and media handoff |
| Conversations | `POST /conversations`, `POST /conversations/{id}/messages`, `GET /conversations/{id}/messages` | Grounded assistant thread |
| Safe actions | `GET /proposals/{id}`, `/confirm`, `/cancel` | Confirming model-proposed mutations |
| Notifications | `GET/PATCH /notifications`, `POST/PATCH /reminders` | In-app and WhatsApp reminders |
| WhatsApp identity | `POST /channels/whatsapp/link`, `DELETE /channels/whatsapp/link` | Link a verified WhatsApp number to a farmer |
| Close season | `POST /seasons/{id}/close`, `GET /seasons/{id}/summary` | Harvest, sales, forecast-vs-actual |

The web app now uses Firebase Phone Auth with SMS OTP. The existing API keeps
Firebase ID tokens as its bearer authority, so no unauthenticated API login route
is needed. Firebase Phone Auth must be enabled for the configured project and
tested with a disposable number before release.

## Decisions required for phone-only auth

Firebase Phone Auth sends an SMS OTP; it does not send an OTP over WhatsApp.
SMS is the selected hackathon path because it avoids a custom OTP broker and a
Meta authentication template. WhatsApp remains a linked channel:

1. Farmer signs in or creates an account with Firebase SMS OTP in the web UI.
2. The API enrolls the verified Firebase user and uses the phone identity from
   Firebase rather than an email/password account.
3. The farmer requests a one-time WhatsApp link code from the authenticated web
   account and sends `LINK <code>` from the WhatsApp number.
4. The signed Meta webhook redeems the code once, creates the channel, and queues
   the message in the normal conversation and assistant pipeline.
5. Replies are delivered through the outbox worker after live Meta credentials
   and an approved send policy are configured.

## WhatsApp guide review

Read `~/Work/agrisense-whatsapp/WHATSAPP_INTEGRATION_GUIDE.md`, `HANDOFF.md`,
and `WHATSAPP_PRODUCT_PLAN.md`. The Meta-side setup is already proven for the
test number, webhook verification, text/image/button receipt, media download,
WABA subscription, and WhatsApp formatting.

The guide needs these updates before production rollout:

- Replace “copy the temporary `.env` into the backend” with the canonical
  `~/Work/agrisense.env` plus Secret Manager mapping.
- Replace the Groq relay with the real API/science/Gemini path. Groq remains a
  disposable plumbing demo only.
- Replace the “future API contract” language with the routes above and the
  generated contract models.
- Remove the phone-over-WhatsApp OTP requirement for the hackathon path; web
  authentication is Firebase SMS OTP and WhatsApp is linked after sign-in.
- Add the `POST /channels/whatsapp/link` flow and require explicit WhatsApp
  consent in the farmer profile.
- Add deduplication by Meta message ID before any side effect; webhook handlers
  must acknowledge quickly and queue work.
- Add message-to-route mappings for onboarding, active-field selection,
  journal, readiness, water, money, reminders, proposals, and season closure.
- Add Meta authentication templates for OTP and any proactive reminder outside
  the 24-hour customer-service window. The current test number is limited to
  five verified recipients.
- Replace the placeholder privacy policy before public use.

## WhatsApp user flows

### First contact and authentication

`hello` or an unknown number starts the OTP/link flow. The bot explains what is
being requested, obtains WhatsApp consent, sends the approved authentication
template, verifies one code, and creates or resumes the farmer account. A
verified web login must resolve to the same farmer when the E.164 number is the
same. A WhatsApp number must never be guessed from display name or message text.

### Onboarding

Collect location, field area/unit, irrigation method, budget/water budget, crop,
and optional product. Use guided list/button messages for known choices and
plain text only where a numeric or location answer is needed. Create the field
and season through the normal API routes. The active field is channel state,
stored durably and scoped to the farmer, not process memory.

### Dashboard and advice

`menu` returns links/actions for readiness, water, money, journal, reminders,
switch field, edit data, and close season. Readiness replies use the backend's
recommendation, selected window, reasons, safety status, evidence, and unknown
states. WhatsApp formatting is applied only at the channel boundary.

### Journal and media

Text, image, and audio messages are deduplicated, media IDs are downloaded with
the Meta token, and bytes go through the existing media custody flow. Journal
entries use `source: "whatsapp"`; the backend decides whether an observation is
confirmed or remains unreviewed. The channel does not invent a diagnosis or
agronomic action.

### Proposals, reminders, and closure

A mutation suggested by the assistant becomes a proposal. The farmer must tap a
button and the adapter calls `/proposals/{id}/confirm` with the current version.
Scheduled reminders use approved templates when outside 24 hours. Closing a
season is a guided confirmation of harvest, sales, costs, and date, then calls
the versioned close route and renders the summary.

## Work order

1. **Configuration and contract preparation.** Use the canonical env file,
   provision missing Secret Manager entries, decide the Firebase custom-token
   broker, add OTP/channel schemas and routes, and regenerate bindings.
2. **Auth migration.** Replace email/password UI, reset-password and email
   verification copy with phone-number/WhatsApp OTP screens. Preserve existing
   tenant isolation and add migration behavior for any existing test accounts.
3. **Real WhatsApp adapter.** The backend now verifies webhooks, deduplicates
   Meta IDs, redeems link codes, creates text conversation turns, runs the
   grounded assistant worker, and queues replies. Complete media download,
   WhatsApp formatting, active-field state, and live Meta verification next.
4. **API integration journeys.** Wire onboarding, readiness, journal/media,
   assistant proposals, reminders, and close-season flows. Add authenticated
   browser/API tests with disposable accounts and no real farmer data.
5. **Landing page.** Implemented with the existing design tokens: hero, problem,
   how-it-works flow, live-data trust, WhatsApp/web entry points, closed-loop
   Season Journal, and a concise demo CTA.
6. **Deployment.** Deploy API, then frontend, update CORS and Meta Callback URL,
   verify Cloud Run health, run the live browser pass, and only then enable any
   approved WhatsApp outbound behavior.

## What can be done now

Ready now in this repository:

- Auth UI and provider migration to Firebase SMS OTP.
- Real WhatsApp text adapter against the existing API, with queued assistant replies.
- Landing page implementation and public-route Playwright coverage.
- Deployment script and frontend/API release verification.
- A reviewed reference-data ingestion change once proper regional per-hectare
  cost, crop calendar, and agronomist-approved product records are supplied.

Blocked on external or human input:

- Real SMS until Firebase Phone Auth is enabled and a disposable test number is
  available; WhatsApp OTP is intentionally out of scope.
- Production deployment until a least-privilege Cloud Build service account is
  provisioned; the current owner account is intentionally not used.
- Crop ranking until regional, citable per-hectare cost and calendar records are
  supplied. The current CACP figures are not enough by themselves.
- Advice certification and spray safety until an agronomist signs off.
- Full live authenticated E2E until the latest API and frontend revisions are
  deployed and disposable phone/WhatsApp test accounts are available.

## Prerequisites and manual verification checklist

### Firebase SMS and web release

- [ ] Enable Phone under Firebase Authentication providers.
- [ ] Confirm the Firebase web app config in ~/Work/agrisense.env matches the API project.
- [ ] Add a disposable E.164 test number or Firebase fictional test number.
- [ ] Add the deployed frontend hostname to Firebase authorized domains.
- [ ] Test sign-up, reload, sign-out, and sign-in again with SMS OTP.
- [ ] Test invalid phone, invalid code, expired code, resend, and rate limiting.
- [ ] Test account export, deletion, and WhatsApp linking after phone verification.

### API and website release

- [ ] Provision a least privilege Cloud Build service account for infra/deploy.sh.
- [ ] Deploy the API and verify /health/live, /health/ready, contracts, and water/advice fixes.
- [ ] Deploy the frontend to the configured Cloudflare Pages/Wrangler project.
- [ ] Verify /, /sign-in, /sign-up, /close-season, /water, and /ask publicly.
- [ ] Confirm frontend API URL, Firebase config, CORS, and Cloud Run URL agree.

### WhatsApp manual flow

- [ ] Configure the Meta callback URL /webhooks/whatsapp and its credentials.
- [ ] Complete SMS sign-in, create a WhatsApp link code, and send LINK <code>.
- [ ] Confirm one inbox row, conversation message, assistant job, and outbound outbox row.
- [ ] Replay the same Meta message ID and confirm no duplicate job or reply.
- [ ] Test unlinked numbers, unlinking, unsupported media, and the 24 hour window.
- [ ] Verify a live Meta text reply only after the outbox dry run is clean.
- [ ] Complete media download/custody for image and voice messages.

### Science/reference data

- [ ] Supply district/state sowing windows for the pilot regions.
- [ ] Supply reviewed seasonal irrigation and per hectare cultivation costs.
- [ ] Supply paired yield/price/cost records before enabling economics ranking.
- [ ] Supply product label constraints and agronomist approval before spray certification.

## Current remaining work

- API and frontend production deployment.
- Firebase Phone Auth activation and real SMS smoke test.
- WhatsApp media, image/voice ingestion, active-field state, formatting, live send, and route mapping.
- Authenticated API/browser E2E against disposable accounts; the 30-test Chromium suite covers public layout, PWA, landing, and phone-form validation.
- Regional crop calendar, economics, product-label, and agronomist inputs.
- Replace the placeholder privacy policy before public use.
