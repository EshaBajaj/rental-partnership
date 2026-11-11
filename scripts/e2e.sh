#!/usr/bin/env bash
# End-to-end test: fresh Postgres DB (migrations + seed) → real Edge Function handlers (Deno, local
# storage, fake Groq/Telegram) → production build of the web app → Playwright (phone viewport).
# Usage: DATABASE_URL=postgresql://postgres@localhost:5432/postgres bash scripts/e2e.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB_DIR="${WEB_DIR:-$ROOT/apps/web}"
ADMIN_URL="${DATABASE_URL:-postgresql://postgres@localhost:54329/postgres}"
DENO="${DENO:-$(command -v deno || echo "$ROOT/node_modules/.bin/deno")}"
DB="sls_e2e_$$"
PSQL=(psql -X -q -v ON_ERROR_STOP=1)
base="${ADMIN_URL%%\?*}"; query=""; [[ "$ADMIN_URL" == *\?* ]] && query="?${ADMIN_URL#*\?}"
E2E_URL="${base%/*}/${DB}${query}"
STORE="$(mktemp -d)"
PIDS=()

cleanup() {
  for p in "${PIDS[@]:-}"; do [[ -n "$p" ]] && kill "$p" 2>/dev/null || true; done
  "${PSQL[@]}" "$ADMIN_URL" -c "drop database if exists ${DB} with (force)" >/dev/null 2>&1 || true
}
trap cleanup EXIT

"${PSQL[@]}" "$ADMIN_URL" -c "create database ${DB}" >/dev/null
if [[ "$("${PSQL[@]}" -tA "$E2E_URL" -c "select count(*) from pg_namespace where nspname = 'auth'")" == "0" ]]; then
  "${PSQL[@]}" "$E2E_URL" -f "$ROOT/supabase/tests/_supabase_stub.sql" >/dev/null 2>&1
fi
for f in "$ROOT"/supabase/migrations/*.sql; do "${PSQL[@]}" "$E2E_URL" -f "$f" >/dev/null 2>&1; done
"${PSQL[@]}" "$E2E_URL" -f "$ROOT/supabase/seed.sql" >/dev/null
echo "✓ database ready ($DB)"

PORT=54400 DATABASE_URL="$E2E_URL" STORE_DIR="$STORE" "$DENO" run --allow-net --allow-env --allow-read --allow-write \
  --config "$ROOT/supabase/functions/deno.json" "$ROOT/scripts/e2e/local-functions.ts" > /tmp/sls-e2e-functions.log 2>&1 &
PIDS+=($!)

(cd "$WEB_DIR" && VITE_FUNCTIONS_URL="http://localhost:54400/functions/v1" VITE_SUPABASE_URL="http://localhost:54400" VITE_SUPABASE_ANON_KEY="e2e" npx vite build >/dev/null)
(cd "$WEB_DIR" && npx vite preview --port 4173 --strictPort > /tmp/sls-e2e-preview.log 2>&1) &
PIDS+=($!)

for i in $(seq 1 60); do
  if curl -sf "http://localhost:54400/functions/v1/form?slug=main-road-shop" >/dev/null && curl -sf "http://localhost:4173/" >/dev/null; then break; fi
  sleep 0.5
  [[ $i == 60 ]] && { echo "servers did not start"; cat /tmp/sls-e2e-functions.log; exit 1; }
done
echo "✓ local functions + web preview up"

APP_URL="http://localhost:4173" FN_URL="http://localhost:54400" DATABASE_URL="$E2E_URL" SHOTS_DIR="${SHOTS_DIR:-}" \
  node "$ROOT/scripts/e2e/respondent.e2e.mjs"
