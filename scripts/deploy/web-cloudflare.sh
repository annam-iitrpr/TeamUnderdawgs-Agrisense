#!/usr/bin/env bash
# Build the static frontend and publish it to Cloudflare Workers Static Assets.
#
# This is where the frontend actually lives. `web.sh` deploys the same app to
# Cloud Run and is kept only for the container path; the public site at
# agrisense.spacesdrive.cc is served from here.
#
# Only NEXT_PUBLIC_* values are baked in, and every one of them is public by
# design — the Firebase web config is handed to every browser that loads the
# page, and the API base is visible in the network tab. No server secret, no
# service-account key and no database URL may ever be added to this file: the
# output is a bundle of static files that anyone can download and read.
#
# Even so, none of those values are written down here. They come from the
# environment, the same way api.sh and web.sh take them: a key committed to the
# repository is a key that has to be rotated when the repository is shared, and
# a secret scanner cannot tell a public Firebase key from a private one — nor
# should it have to guess.
set -euo pipefail

: "${FIREBASE_API_KEY:?set FIREBASE_API_KEY}"
: "${FIREBASE_PROJECT_ID:?set FIREBASE_PROJECT_ID}"

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT/web"

# The client appends bare paths such as /fields, so the base must carry the
# /api/v1 prefix. Without it every call 404s and the app looks broken while the
# API is perfectly healthy — this has already cost one debugging session.
API_BASE="${PUBLIC_API_BASE_URL:-https://agrisense-api-788265611154.asia-south1.run.app}"
API_BASE="${API_BASE%/}"
[[ "$API_BASE" == */api/v1 ]] || API_BASE="${API_BASE}/api/v1"

export NEXT_PUBLIC_API_BASE="$API_BASE"
export NEXT_PUBLIC_FIREBASE_API_KEY="$FIREBASE_API_KEY"
export NEXT_PUBLIC_FIREBASE_PROJECT_ID="$FIREBASE_PROJECT_ID"
export NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN="${FIREBASE_AUTH_DOMAIN:-${FIREBASE_PROJECT_ID}.firebaseapp.com}"
export NEXT_PUBLIC_FIREBASE_APP_ID="${FIREBASE_APP_ID:-}"
export NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID="${FIREBASE_MESSAGING_SENDER_ID:-}"
export NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET="${FIREBASE_STORAGE_BUCKET:-}"

# A build missing the app id produces a bundle whose Firebase client cannot
# initialise, which surfaces to a farmer as "sign-in is broken" rather than as
# a deploy mistake. Better to fail here.
if [[ -z "$NEXT_PUBLIC_FIREBASE_APP_ID" ]]; then
  echo "Refusing to build: FIREBASE_APP_ID is not set." >&2
  exit 1
fi

npm run build

# A build that silently fell back to a localhost default produces a bundle that
# works on this machine and for nobody else, so it is refused before upload
# rather than discovered by a user.
if grep -rqE "127\.0\.0\.1:8000|localhost:8000" out/_next/static/chunks; then
  echo "Refusing to deploy: the bundle contains a localhost API base." >&2
  exit 1
fi
if ! grep -rqF "$API_BASE" out/_next/static/chunks; then
  echo "Refusing to deploy: the bundle does not contain $API_BASE." >&2
  exit 1
fi

npx wrangler deploy
