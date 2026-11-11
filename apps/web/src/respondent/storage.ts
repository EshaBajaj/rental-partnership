// Progress + outbox persistence in localStorage, so nothing a respondent typed is lost
// (reloads, bad network, closing the tab).
import type { RawAnswers } from '@shared/types.ts';
import type { SubmitPayload } from './api.ts';
import type { Lang } from './i18n.ts';

export interface Progress {
  v: 1;
  slug: string;
  response_id: string;
  form_version_id: string;
  answers: RawAnswers;
  current: string | null; // key of the current question
  started_at: number;
  lang: Lang;
  /** keys with an uploaded recording (value may still be pending text) */
  voice: Record<string, { uploads: number; pending: boolean }>;
}

const pKey = (slug: string) => `sls.progress.${slug}`;
const oKey = (slug: string) => `sls.outbox.${slug}`;
const dKey = (slug: string) => `sls.done.${slug}`;

function read<T>(k: string): T | null {
  try {
    const s = localStorage.getItem(k);
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
}
function write(k: string, v: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* storage full / private mode: keep going in memory */
  }
}
function del(k: string) {
  try {
    localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

export const loadProgress = (slug: string) => {
  const p = read<Progress>(pKey(slug));
  // forget very old drafts (7 days)
  if (p && (p.v !== 1 || Date.now() - p.started_at > 7 * 86400_000)) {
    del(pKey(slug));
    return null;
  }
  return p;
};
export const saveProgress = (p: Progress) => write(pKey(p.slug), p);
export const clearProgress = (slug: string) => del(pKey(slug));

export const loadOutbox = (slug: string) => read<SubmitPayload>(oKey(slug));
export const saveOutbox = (slug: string, p: SubmitPayload) => write(oKey(slug), p);
export const clearOutbox = (slug: string) => del(oKey(slug));

export interface Done {
  id: string;
  name: string;
  whatsapp: boolean;
  waitlist: boolean;
  at: number;
}
export const loadDone = (slug: string) => {
  const d = read<Done>(dKey(slug));
  return d && Date.now() - d.at < 86400_000 ? d : null;
};
export const saveDone = (slug: string, d: Done) => write(dKey(slug), d);
export const clearDone = (slug: string) => del(dKey(slug));

export function uuid(): string {
  const c: Crypto = globalThis.crypto;
  if (typeof c.randomUUID === 'function') return c.randomUUID();
  // RFC4122 v4 fallback (older Android WebViews, non-secure contexts)
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
