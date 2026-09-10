# AgriSense team setup and manual testing

This is the copy-ready handoff for a teammate who has cloned the repository.
The implementation source of truth is `docs/AGRISE_INTEGRATION_PLAN.md`.

## Setup message

Copy and send the text below:

```text
AgriSense setup

1. Install Git, Python 3.12, Node.js 24, npm, and uv.

2. Clone the repository:
   git clone https://github.com/annam-iitrpr/TeamUnderdawgs-Agrisense.git
   cd TeamUnderdawgs-Agrisense

3. Backend dependencies:
   cd backend
   uv sync --dev
   cd ..

4. Get the canonical environment file through our approved private channel.
   Save it outside the repository as ~/Work/agrisense.env.
   Never commit it, upload it to GitHub, or paste it into a public chat.

5. Start the backend locally:
   cd backend
   AGRISENSE_ENV_FILE=~/Work/agrisense.env APP_ENV=development DATABASE_URL=sqlite:// WHATSAPP_SEND_MODE=outbox uv run uvicorn agrisense.main:app --reload --host 127.0.0.1 --port 8000

6. In a second terminal, install and start the web app:
   cd ~/Work/agrisense/web
   npm ci
   npm run dev
   Open http://127.0.0.1:3000

7. The web app needs web/.env.local. Do not paste the backend env file there
   unchanged. It needs the NEXT_PUBLIC_* Firebase values and API URL:
   NEXT_PUBLIC_API_BASE=http://127.0.0.1:8000/api/v1
   NEXT_PUBLIC_FIREBASE_API_KEY=<FIREBASE_API_KEY>
   NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=<FIREBASE_AUTH_DOMAIN>
   NEXT_PUBLIC_FIREBASE_PROJECT_ID=<FIREBASE_PROJECT_ID>
   NEXT_PUBLIC_FIREBASE_APP_ID=<FIREBASE_APP_ID>
   NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=<FIREBASE_MESSAGING_SENDER_ID>
   NEXT_PUBLIC_ENABLE_DEV_HARNESS=false
   Use the deployed API URL instead of localhost for deployed-site testing.

8. Run web checks:
   cd web
   npm test -- --run
   npm run typecheck
   npm run lint

9. Run backend checks:
   cd backend
   uv run pytest -q
   uv run ruff check agrisense tests

10. Run the public browser suite after the web server starts:
    cd web
    npm run test:e2e
    This is contract-fixture coverage for public UI, layout, PWA, landing,
    and phone-form behavior. It is not live API coverage.

11. For Firebase fictional-number coverage, configure a fictional number and
    fixed code in Firebase Console, then run:
    FIREBASE_TEST_PHONE='+91...' FIREBASE_TEST_CODE='123456' npm run test:e2e -- tests/e2e/phase1/phone-auth-live.spec.ts

12. Read docs/AGRISE_INTEGRATION_PLAN.md and
    docs/TEAM_SETUP_AND_MANUAL_TESTING.md before changing code. Update the
    status and remaining-work lists whenever work is completed.
```

## Environment sharing rules

`~/Work/agrisense.env` is the consolidated backend configuration. It contains
database credentials, provider keys, Firebase values, GCP values, and Meta/
WhatsApp credentials. Share it only through the team’s approved private
secret-sharing method. Do not send the actual file in a WhatsApp group, commit
it, or place it in a GitHub issue.

The `NEXT_PUBLIC_*` Firebase web settings are client configuration and are
visible in a browser, but teammates should still receive them through the
project’s private setup channel. The web file must be named `web/.env.local`;
it is ignored by Git. Copying the backend env file into it unchanged will leave
the web app without the names it expects.

For local work, use `DATABASE_URL=sqlite://`, `APP_ENV=development`, and
`WHATSAPP_SEND_MODE=outbox` unless the task specifically requires a shared
deployment. Never enable live WhatsApp sending while testing with a real farmer
number.

## Manual testing message

Copy and send the text below:

```text
AgriSense manual testing checklist

Record the date, tester, browser/device, environment URL, and result for every
scenario. Use only a Firebase fictional number or disposable test account and
synthetic farm data. Do not use a real farmer’s phone, soil card, voice note, or
financial information.

WEB / FIREBASE SMS
[ ] Landing page works on mobile and desktop; CTA, navigation, sections,
    footer, and WhatsApp/web entry points work.
[ ] Sign-in and sign-up show phone-number login only; no email/password controls.
[ ] Invalid phone format is rejected clearly.
[ ] Firebase fictional number accepts the fixed code and reaches the dashboard.
[ ] Reload keeps the session; sign-out removes access; sign-in works again.
[ ] Invalid, expired, incomplete, resend, and rate-limit OTP states are clear.
[ ] Unauthenticated navigation redirects safely to sign-in.
[ ] Create fields using hectares and acres; check conversion and rounding.
[ ] Add a crop/season to a non-round converted field; submission succeeds.
[ ] Soil-card upload, review, save, and discard work.
[ ] A same-day volumetric moisture reading works after a soil card.
[ ] Evaluation, readiness, water, advice, journal, and close-season screens
    show useful unknown/reason text when reference data is absent.
[ ] Journal text, cost, quantity, and media attachment work.
[ ] Proposal Confirm and Cancel require the visible action and show the result.
[ ] Reminder creation/cancellation and season-close summary work.
[ ] Account export and deletion work for the disposable account.

WHATSAPP / META
[ ] Deployed callback URL and verify-token challenge succeed.
[ ] Missing or wrong X-Hub-Signature-256 returns 403.
[ ] Correctly signed messages receive HTTP 200 quickly.
[ ] LINK <code> links exactly one channel and the code cannot be reused.
[ ] Duplicate Meta message ID creates no duplicate job or side effect.
[ ] Unlinked numbers never get guessed into an account.
[ ] menu/help/start, fields, and use <field name> are understandable and persist
    the active field.
[ ] Send log watered 20 mm, log sprayed, and a normal journal sentence; verify
    source is WhatsApp and quantity is correct.
[ ] Photo and voice note media are downloaded, validated, stored in custody,
    and attached to the resulting turn.
[ ] Unsupported media is rejected safely without an empty assistant reply.
[ ] Assistant proposal Confirm applies once; Cancel leaves it unapplied.
[ ] remind <ISO datetime> creates a reminder for the active season.
[ ] close displays its format, accepts valid data, and returns a season summary.
[ ] readiness, water, money, and history return farmer-readable text and honest
    unavailable states.
[ ] Outbox mode queues messages and sends nothing.
[ ] Controlled live test sends within 24 hours; outside 24 hours free-form text
    is refused until an approved template is configured.
[ ] Unlinking stops later messages from entering the account.

RELEASE SMOKE TEST
[ ] API /health/live succeeds.
[ ] API /health/ready reports expected database/provider state.
[ ] Deployed frontend uses the current API URL and Firebase project.
[ ] CORS allows the deployed frontend origin.
[ ] /, /sign-in, /sign-up, /close-season, /water, and /ask load publicly.
[ ] Latest API revision contains water-reading and stale-advice fixes.
[ ] Meta webhook points to the latest API revision.
[ ] Worker processes inbound jobs and drains WhatsApp outbox only when live
    sending is deliberately enabled.

For every failure send the checklist item, timestamp, device/browser, expected
result, actual result, and a screenshot or redacted log. Redact phone numbers,
OTPs, access tokens, database URLs, media contents, and secrets.
```
