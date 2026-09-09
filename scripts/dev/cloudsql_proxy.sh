#!/usr/bin/env bash
# Local Cloud SQL access. The deployed DATABASE_URL uses the /cloudsql unix socket, which
# exists only inside Cloud Run; and the instance publishes no authorized networks, so a direct
# public-IP connection always times out. The Auth Proxy is the supported local path: it
# authorizes with Application Default Credentials and always encrypts the connection, so the
# instance never needs a home IP allow-listed.
#
#   gcloud auth application-default login   # once, needs roles/cloudsql.client
#   scripts/dev/cloudsql_proxy.sh           # leave running in its own terminal
#
# Then point the app at the tunnel (never commit the resulting URL):
#   DATABASE_URL="postgresql+psycopg://${CLOUDSQL_APP_USER}:${CLOUDSQL_APP_PASSWORD}@127.0.0.1:${PORT}/${CLOUDSQL_DB_NAME}"
set -euo pipefail

PORT="${CLOUDSQL_PROXY_PORT:-5433}"
BIN="${CLOUD_SQL_PROXY_BIN:-$HOME/.local/bin/cloud-sql-proxy}"
VERSION="${CLOUD_SQL_PROXY_VERSION:-v2.19.0}"
ENV_FILE="${AGRISENSE_ENV_FILE:-$(cd "$(dirname "$0")/../.." && pwd)/../agrisense.env}"

if [[ -z "${CLOUDSQL_INSTANCE_CONNECTION_NAME:-}" ]]; then
  [[ -f "$ENV_FILE" ]] || { echo "Set CLOUDSQL_INSTANCE_CONNECTION_NAME or provide AGRISENSE_ENV_FILE." >&2; exit 1; }
  # Read only the one non-secret key this script needs; the rest of the file stays unread.
  CLOUDSQL_INSTANCE_CONNECTION_NAME="$(sed -n 's/^CLOUDSQL_INSTANCE_CONNECTION_NAME=["'"'"']\{0,1\}\([^"'"'"']*\).*/\1/p' "$ENV_FILE" | head -1)"
fi

if [[ ! -x "$BIN" ]]; then
  case "$(uname -s)/$(uname -m)" in
    Darwin/arm64) ASSET=darwin.arm64 ;; Darwin/x86_64) ASSET=darwin.amd64 ;;
    Linux/aarch64) ASSET=linux.arm64 ;; Linux/x86_64) ASSET=linux.amd64 ;;
    *) echo "Install cloud-sql-proxy manually and set CLOUD_SQL_PROXY_BIN." >&2; exit 1 ;;
  esac
  mkdir -p "$(dirname "$BIN")"
  curl -fsSL -o "$BIN" "https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/${VERSION}/cloud-sql-proxy.${ASSET}"
  chmod +x "$BIN"
fi

gcloud auth application-default print-access-token >/dev/null 2>&1 || {
  echo "No Application Default Credentials. Run: gcloud auth application-default login" >&2; exit 1; }

echo "Tunnelling ${CLOUDSQL_INSTANCE_CONNECTION_NAME} to 127.0.0.1:${PORT}"
exec "$BIN" --port "$PORT" "$CLOUDSQL_INSTANCE_CONNECTION_NAME"
