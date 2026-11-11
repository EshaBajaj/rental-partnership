#!/usr/bin/env bash
# Type-check every Edge Function and run the Deno handler tests.
set -euo pipefail
cd "$(dirname "$0")/../supabase/functions"
DENO="${DENO:-$(command -v deno || echo ../../node_modules/.bin/deno)}"
"$DENO" check --config deno.json */index.ts
"$DENO" test --config deno.json --allow-env --allow-read tests/
