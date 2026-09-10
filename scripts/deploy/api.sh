#!/usr/bin/env bash
# Build, push and deploy the platform API to Cloud Run.
#
# Secrets are never passed as arguments or baked into the image; the service reads them from
# Secret Manager at start. Create them once, from a local file that is never committed:
#   printf %s "$DATABASE_URL"  | gcloud secrets create agrisense-database-url --data-file=-
#   openssl rand -hex 32 | gcloud secrets create agrisense-media-signing-secret --data-file=-
#
# Requires: GCP_PROJECT_ID, GCP_REGION, CLOUDSQL_INSTANCE_CONNECTION_NAME, FIREBASE_PROJECT_ID,
# CLOUD_RUN_API_URL, CLOUD_RUN_WEB_URL, GCS_MEDIA_BUCKET, API_SERVICE_ACCOUNT.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
: "${GCP_PROJECT_ID:?set GCP_PROJECT_ID}"
: "${GCP_REGION:?set GCP_REGION}"
: "${CLOUDSQL_INSTANCE_CONNECTION_NAME:?set CLOUDSQL_INSTANCE_CONNECTION_NAME}"
: "${FIREBASE_PROJECT_ID:?set FIREBASE_PROJECT_ID}"
: "${CLOUD_RUN_API_URL:?set CLOUD_RUN_API_URL}"
: "${CLOUD_RUN_WEB_URL:?set CLOUD_RUN_WEB_URL}"
: "${GCS_MEDIA_BUCKET:?set GCS_MEDIA_BUCKET}"
: "${API_SERVICE_ACCOUNT:?set API_SERVICE_ACCOUNT}"

# Defaults to the deployed web origin alone. Widen it deliberately, never by accident.
export CORS_ALLOWED_ORIGINS="${CORS_ALLOWED_ORIGINS:-$CLOUD_RUN_WEB_URL}"
# Outbound messaging stays queued unless this is set deliberately: live means real people.
export WHATSAPP_SEND_MODE="${WHATSAPP_SEND_MODE:-outbox}"
export GEMINI_MODEL="${GEMINI_MODEL:-gemini-3.8-flash}"
export CEHUB_API_KEY_HEADER="${CEHUB_API_KEY_HEADER:-ApiKey}"
# Set these only once a reviewed crop-vision model is actually deployed.
export VISION_ENDPOINT_URL="${VISION_ENDPOINT_URL:-}"
export VERTEX_VISION_ENDPOINT="${VERTEX_VISION_ENDPOINT:-}"
export VISION_LOCATION="${VISION_LOCATION:-$GCP_REGION}"

REPOSITORY="${ARTIFACT_REPOSITORY:-agrisense}"
TAG="$(git -C "$ROOT" rev-parse --short HEAD)"
export API_IMAGE="${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/${REPOSITORY}/agrisense-api:${TAG}"

# Refuse to ship a dirty tree: the deployed tag must name code that exists in history.
if [[ -n "$(git -C "$ROOT" status --porcelain)" ]]; then
  echo "Working tree is dirty; commit before deploying so ${TAG} is reproducible." >&2
  exit 1
fi

gcloud artifacts repositories describe "$REPOSITORY" --location "$GCP_REGION" --project "$GCP_PROJECT_ID" >/dev/null 2>&1 ||
  gcloud artifacts repositories create "$REPOSITORY" --repository-format=docker --location "$GCP_REGION" --project "$GCP_PROJECT_ID"

gcloud auth configure-docker "${GCP_REGION}-docker.pkg.dev" --quiet
docker build --platform linux/amd64 -f "$ROOT/backend/Dockerfile" -t "$API_IMAGE" "$ROOT"
docker push "$API_IMAGE"

# Migrations run before the new revision serves, so no request meets a schema it predates.
echo "Run migrations against the target database before continuing (scripts/dev/cloudsql_proxy.sh + alembic upgrade head)."
read -r -p "Migrations applied? [y/N] " confirmed
[[ "$confirmed" == "y" ]] || { echo "Aborted."; exit 1; }

export REVISION_SUFFIX="${TAG}-$(date +%H%M%S)"
RENDERED="$(mktemp)"
trap 'rm -f "$RENDERED"' EXIT
envsubst < "$ROOT/infra/cloudrun-api.yaml" > "$RENDERED"
gcloud run services replace "$RENDERED" --region "$GCP_REGION" --project "$GCP_PROJECT_ID"

# `replace` succeeds even when the new revision never becomes ready, in which case traffic
# silently stays on the old one. Verify what is actually serving rather than trusting exit 0.
SERVING="$(gcloud run services describe agrisense-api --region "$GCP_REGION" --project "$GCP_PROJECT_ID" \
  --format='value(status.traffic[0].revisionName)')"
READY="$(gcloud run revisions describe "$SERVING" --region "$GCP_REGION" --project "$GCP_PROJECT_ID" \
  --format='value(spec.containers[0].image)')"
if [[ "$READY" != "$API_IMAGE" ]]; then
  echo "Deploy did not take: ${SERVING} is serving ${READY}, not ${API_IMAGE}." >&2
  gcloud run revisions list --service agrisense-api --region "$GCP_REGION" --project "$GCP_PROJECT_ID" \
    --format='value(metadata.name,status.conditions[0].status,status.conditions[0].message)' | head -3 >&2
  exit 1
fi
echo "Deployed and serving ${API_IMAGE}"
