#!/usr/bin/env bash
# Local demo with no Supabase account: fresh DB + seed + 3 demo leads, real Edge Function
# handlers + test stand-in for auth/REST, web app preview on :4173.
# Admin login: owner@shop.test / e2e-password   (test-only auth, never deploy this)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
U="${DATABASE_URL:-postgresql://postgres@localhost:54329}"; U="${U%/postgres}"
P=(psql -X -q -v ON_ERROR_STOP=1)
"${P[@]}" "$U/postgres" -c "drop database if exists sls_demo with (force)" -c "create database sls_demo" >/dev/null
"${P[@]}" "$U/sls_demo" -f "$ROOT/supabase/tests/_supabase_stub.sql" >/dev/null 2>&1
for f in "$ROOT"/supabase/migrations/*.sql; do "${P[@]}" "$U/sls_demo" -f "$f" >/dev/null 2>&1; done
"${P[@]}" "$U/sls_demo" -f "$ROOT/supabase/seed.sql" >/dev/null
"${P[@]}" "$U/sls_demo" -f "$ROOT/supabase/tests/_helpers.sql" >/dev/null 2>&1
"${P[@]}" "$U/sls_demo" >/dev/null <<'SQL'
insert into auth.users (id, email) values ('aaaaaaaa-0000-4000-8000-000000000001', 'owner@shop.test');
insert into public.admins values ('aaaaaaaa-0000-4000-8000-000000000001', 'owner@shop.test', 'owner');
select t.submit(gen_random_uuid(), jsonb_build_object('path', t.a('"rent"'), 'business_type', t.a('"grocery"', 'Grocery / Kirana'), 'start_when', t.a('"immediately"', 'Immediately'), 'rent_budget', t.a('45000', '₹45,000'), 'lease_years', t.a('"3_5"', '3–5 years'), 'experience', t.a('"yes"', 'Yes')), '+919876543210', 140);
select t.submit(gen_random_uuid(), jsonb_build_object('path', t.a('"partner"'), 'business_type', t.a('"clothing"', 'Clothing'), 'start_when', t.a('"1_3_months"', 'In 1–3 months'), 'investment', t.a('1500000', '₹15,00,000'), 'partner_role', t.a('"active"', 'Active'), 'experience', t.a('"no"', 'No')), '+919123456780', 95);
select t.submit(gen_random_uuid(), jsonb_build_object('path', t.a('"rent"'), 'business_type', t.a('"restaurant"', 'Restaurant / food'), 'start_when', t.a('"later"', 'Later / not sure'), 'rent_budget', t.a('25000', '₹25,000'), 'lease_years', t.a('"1_2"', '1–2 years'), 'experience', t.a('"yes"', 'Yes')), '+919988776655', 60);
update public.responses set name = case phone_e164 when '+919876543210' then 'Ramesh Kumar' when '+919123456780' then 'Sunita Devi' else 'Vikram Singh' end;
SQL
cd "$ROOT/apps/web" && VITE_SUPABASE_URL="same-origin" VITE_SUPABASE_ANON_KEY=demo "$ROOT/node_modules/.bin/vite" build >/dev/null
PORT=54400 DATABASE_URL="$U/sls_demo" "$ROOT/node_modules/.bin/deno" run -A --config "$ROOT/supabase/functions/deno.json" "$ROOT/scripts/e2e/local-functions.ts" &
exec "$ROOT/node_modules/.bin/vite" preview --port 4173 --strictPort --host 0.0.0.0
