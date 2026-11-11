// Merge stored profile-set settings over the defaults (mirrors SQL sls_merge: timing_points replaced, not merged).
import { DEFAULT_PROFILE_SETTINGS, type ProfileSetSettings } from '@shared/types.ts';

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

function merge(a: Record<string, unknown>, b: unknown): Record<string, unknown> {
  if (!isObj(b)) return a;
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (v === undefined || v === null) continue;
    out[k] = isObj(a[k]) && isObj(v) && k !== 'timing_points' ? merge(a[k] as Record<string, unknown>, v) : v;
  }
  return out;
}

export function mergeSettings(stored: unknown): ProfileSetSettings {
  return merge(structuredClone(DEFAULT_PROFILE_SETTINGS) as unknown as Record<string, unknown>, stored) as unknown as ProfileSetSettings;
}
