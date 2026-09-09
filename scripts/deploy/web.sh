#!/usr/bin/env bash
# Deploy the web app to Cloud Run as `agrisense-web`.
#
# The service name matters: the resulting origin is
#   https://agrisense-web-<project number>-<region>.run.app
# and that exact origin is already in the API's CORS allowlist, so a deploy under this name
# works immediately with no change on the API side. Deploying under another name needs the
# allowlist widened first.
#
# Only NEXT_PUBLIC_* values are baked in, and those are public by design: the Firebase web
# config is served to every browser anyway. No server secret belongs in this image.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
: "${GCP_PROJECT_ID:?set GCP_PROJECT_ID}"
: "${GCP_REGION:?set GCP_REGION}"
: "${FIREBASE_API_KEY:?set FIREBASE_API_KEY}"
: "${FIREBASE_PROJECT_ID:?set FIREBASE_PROJECT_ID}"

SERVICE="${WEB_SERVICE_NAME:-agrisense-web}"
REPOSITORY="${ARTIFACT_REPOSITORY:-agrisense}"
TAG="$(git -C "$ROOT" rev-parse --short HEAD)"
IMAGE="${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/${REPOSITORY}/${SERVICE}:${TAG}"
API_BASE="${PUBLIC_API_BASE_URL:-https://agrisense-api-788265611154.asia-south1.run.app}"

gcloud auth configure-docker "${GCP_REGION}-docker.pkg.dev" --quiet

docker build --platform linux/amd64 -f "$ROOT/web/Dockerfile" -t "$IMAGE" \
  --build-arg NEXT_PUBLIC_API_BASE="$API_BASE" \
  --build-arg NEXT_PUBLIC_FIREBASE_API_KEY="$FIREBASE_API_KEY" \
  --build-arg NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN="${FIREBASE_AUTH_DOMAIN:-}" \
  --build-arg NEXT_PUBLIC_FIREBASE_PROJECT_ID="$FIREBASE_PROJECT_ID" \
  --build-arg NEXT_PUBLIC_FIREBASE_APP_ID="${FIREBASE_APP_ID:-}" \
  --build-arg NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET="${FIREBASE_STORAGE_BUCKET:-}" \
  --build-arg NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID="${FIREBASE_MESSAGING_SENDER_ID:-}" \
  "$ROOT"
docker push "$IMAGE"

gcloud run deploy "$SERVICE" \
  --image "$IMAGE" --region "$GCP_REGION" --project "$GCP_PROJECT_ID" \
  --allow-unauthenticated --port 8080 --cpu 1 --memory 512Mi \
  --min-instances 0 --max-instances 4 --concurrency 80

echo "Web deployed. Origin: $(gcloud run services describe "$SERVICE" --region "$GCP_REGION" --project "$GCP_PROJECT_ID" --format='value(status.url)')"
