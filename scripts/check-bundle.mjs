// Respondent bundle budget: entry chunk + its *static* imports (+ CSS), gzipped, must be < 150 KB.
// Admin code is reached only through dynamic import() and is excluded.
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../apps/web/dist/', import.meta.url));
const LIMIT = 150 * 1024;
const manifest = JSON.parse(readFileSync(join(dist, '.vite/manifest.json'), 'utf8'));
const entryKey = Object.keys(manifest).find((k) => manifest[k].isEntry);
if (!entryKey) throw new Error('no entry in manifest');

const seen = new Set();
const files = [];
(function walk(key) {
  if (seen.has(key)) return;
  seen.add(key);
  const m = manifest[key];
  files.push(m.file, ...(m.css ?? []));
  for (const i of m.imports ?? []) walk(i);
})(entryKey);

let total = 0;
const rows = [...new Set(files)].map((f) => {
  const gz = gzipSync(readFileSync(join(dist, f)), { level: 9 }).length;
  total += gz;
  return [f, gz];
});
const html = gzipSync(readFileSync(join(dist, 'index.html'))).length;
total += html;
for (const [f, gz] of rows) console.log(`${(gz / 1024).toFixed(1).padStart(7)} KB  ${f}`);
console.log(`${(html / 1024).toFixed(1).padStart(7)} KB  index.html`);
console.log(`respondent total (gzip): ${(total / 1024).toFixed(1)} KB / ${LIMIT / 1024} KB`);
const leaked = files.filter((f) => /admin|supabase|dndkit|qrcode/i.test(f));
if (leaked.length) {
  console.error(`✗ admin-only code leaked into the respondent bundle: ${leaked.join(', ')}`);
  process.exit(1);
}
if (total >= LIMIT) {
  console.error('✗ respondent bundle over budget');
  process.exit(1);
}
console.log('✓ respondent bundle within budget');
