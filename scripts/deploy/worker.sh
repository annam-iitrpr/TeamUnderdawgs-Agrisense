#!/usr/bin/env bash
# Deploy the worker as a Cloud Run job and schedule it.
#
# A job rather than a service: each invocation drains what is queued and exits, so there is no
# always-on instance to pay for and a failed pass is visible in the job history instead of
# being swallowed by a restart loop. The same image as the API is used, so the worker can
# never run code the API was not built from.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
: "${GCP_PROJECT_ID:?set GCP_PROJECT_ID}"
: "${GCP_REGION:?set GCP_REGION}"
: "${CLOUDSQL_INSTANCE_CONNECTION_NAME:?set CLOUDSQL_INSTANCE_CONNECTION_NAME}"
: "${API_IMAGE:?set API_IMAGE}"
: "${API_SERVICE_ACCOUNT:?set API_SERVICE_ACCOUNT}"
: "${GCS_MEDIA_BUCKET:?set GCS_MEDIA_BUCKET}"

JOB="${WORKER_JOB_NAME:-agrisense-worker}"
SCHEDULE="${WORKER_SCHEDULE:-* * * * *}"

ENV_VARS="APP_ENV=production,AGRISENSE_ENV_FILE=/dev/null,AGRISENSE_DATA_MODE=live"
ENV_VARS="$ENV_VARS,FIREBASE_PROJECT_ID=${FIREBASE_PROJECT_ID},GOOGLE_CLOUD_PROJECT=${GCP_PROJECT_ID}"
ENV_VARS="$ENV_VARS,GOOGLE_CLOUD_LOCATION=${GCP_REGION},GCS_MEDIA_BUCKET=${GCS_MEDIA_BUCKET}"
[[ -n "${ANALYTICS_DATASET:-}" ]] && ENV_VARS="$ENV_VARS,ANALYTICS_DATASET=${ANALYTICS_DATASET}"

ACTION=create
gcloud run jobs describe "$JOB" --region "$GCP_REGION" --project "$GCP_PROJECT_ID" >/dev/null 2>&1 && ACTION=update

# --args needs the = form: its value starts with a dash and would parse as a flag otherwise.
gcloud run jobs "$ACTION" "$JOB" \
  --region "$GCP_REGION" --project "$GCP_PROJECT_ID" \
  --service-account "$API_SERVICE_ACCOUNT" \
  --set-cloudsql-instances "$CLOUDSQL_INSTANCE_CONNECTION_NAME" \
  --set-env-vars "$ENV_VARS" \
  --set-secrets "DATABASE_URL=agrisense-database-url:latest,MEDIA_SIGNING_SECRET=agrisense-media-signing-secret:latest" \
  --max-retries 1 --task-timeout 600 \
  --image "$API_IMAGE" --command python --args="-m,agrisense.platform.worker_main" \
  --memory 512Mi --cpu 1

# A dedicated invoker identity: the scheduler may start this job and nothing else.
INVOKER="agrisense-scheduler@${GCP_PROJECT_ID}.iam.gserviceaccount.com"
gcloud iam service-accounts describe "$INVOKER" --project "$GCP_PROJECT_ID" >/dev/null 2>&1 || \
  gcloud iam service-accounts create agrisense-scheduler --project "$GCP_PROJECT_ID" \
    --display-name="AgriSense worker scheduler" \
    --description="Invokes the worker job on a schedule. No other permission."
gcloud run jobs add-iam-policy-binding "$JOB" --region "$GCP_REGION" --project "$GCP_PROJECT_ID" \
  --member "serviceAccount:$INVOKER" --role roles/run.invoker --quiet >/dev/null

URI="https://${GCP_REGION}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${GCP_PROJECT_ID}/jobs/${JOB}:run"
SCHED_ACTION=create
gcloud scheduler jobs describe "${JOB}-tick" --location "$GCP_REGION" --project "$GCP_PROJECT_ID" >/dev/null 2>&1 && SCHED_ACTION=update
gcloud scheduler jobs "$SCHED_ACTION" http "${JOB}-tick" \
  --location "$GCP_REGION" --project "$GCP_PROJECT_ID" \
  --schedule "$SCHEDULE" --time-zone "Asia/Kolkata" \
  --uri "$URI" --http-method POST \
  --oauth-service-account-email "$INVOKER" \
  --attempt-deadline 600s

echo "Worker job ${JOB} deployed and scheduled: ${SCHEDULE} (Asia/Kolkata)"
