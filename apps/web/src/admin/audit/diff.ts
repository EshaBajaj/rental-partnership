// Field-level diff of two audit snapshots.
const IGNORE = new Set(['updated_at']);

function show(v: unknown): string {
  if (v === undefined) return '';
  if (v === null) return '∅';
  return typeof v === 'string' ? v : JSON.stringify(v);
}

export function diffRows(before: Record<string, unknown> | null, after: Record<string, unknown> | null): { field: string; before: string; after: string }[] {
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].filter((k) => !IGNORE.has(k)).sort();
  const out: { field: string; before: string; after: string }[] = [];
  for (const k of keys) {
    const a = before?.[k];
    const b = after?.[k];
    if (before && after && JSON.stringify(a) === JSON.stringify(b)) continue;
    out.push({ field: k, before: show(a), after: show(b) });
  }
  return out;
}
