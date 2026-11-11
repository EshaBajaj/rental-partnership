#!/usr/bin/env bash
# Database test runner: fresh database → Supabase stub (when needed) → migrations → seed → tests.
# Usage: DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres bash scripts/test-db.sh
set -euo pipefail
cd "$(dirname "$0")/.."

ADMIN_URL="${DATABASE_URL:-postgresql://postgres@localhost:54329/postgres}"
DB="sls_test_$$"
PSQL=(psql -X -q -v ON_ERROR_STOP=1)

base="${ADMIN_URL%%\?*}"; query=""; [[ "$ADMIN_URL" == *\?* ]] && query="?${ADMIN_URL#*\?}"
TEST_URL="${base%/*}/${DB}${query}"

"${PSQL[@]}" "$ADMIN_URL" -c "create database ${DB}" >/dev/null
cleanup() { "${PSQL[@]}" "$ADMIN_URL" -c "drop database if exists ${DB} with (force)" >/dev/null 2>&1 || true; }
trap cleanup EXIT

if [[ "$("${PSQL[@]}" -tA "$TEST_URL" -c "select count(*) from pg_namespace where nspname = 'auth'")" == "0" ]]; then
  "${PSQL[@]}" "$TEST_URL" -f supabase/tests/_supabase_stub.sql >/dev/null
fi

for f in supabase/migrations/*.sql; do
  "${PSQL[@]}" "$TEST_URL" -f "$f" >/dev/null 2> >(grep -v NOTICE >&2) || { echo "✗ migration failed: $f"; exit 1; }
done
echo "✓ migrations applied ($(ls supabase/migrations/*.sql | wc -l))"
"${PSQL[@]}" "$TEST_URL" -f supabase/seed.sql >/dev/null
echo "✓ seed applied"
"${PSQL[@]}" "$TEST_URL" -f supabase/tests/_helpers.sql >/dev/null

pass=0; fail=0
for t in supabase/tests/*.test.sql; do
  if out=$("${PSQL[@]}" "$TEST_URL" -c "begin" -f "$t" -c "rollback" 2>&1); then
    echo "✓ $(basename "$t")"; pass=$((pass+1))
  else
    echo "✗ $(basename "$t")"; echo "$out" | grep -E "ERROR|CONTEXT|DETAIL|HINT|psql:" | head -20; fail=$((fail+1))
  fi
done
echo "db tests: ${pass} passed, ${fail} failed"
[[ $fail -eq 0 ]]
