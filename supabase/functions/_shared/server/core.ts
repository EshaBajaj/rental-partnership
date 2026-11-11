// Shared server logic: rate limiting, auth for internal endpoints, voice transcription, notifications.
import { bearer, HttpError, safeEqual, sha256Hex } from './http.ts';
import { DbError, type Deps, type LeadForNotify, type NotificationRow, UpstreamError, type VoiceNoteRow } from './deps.ts';
import { escapeHtml } from './telegram.ts';
import { formatPhone } from '../phone.ts';

export async function ipHash(deps: Deps, ip: string): Promise<string> {
  return await sha256Hex(`${ip}${deps.env.ipSalt}`);
}

export async function rateLimit(deps: Deps, bucket: string, key: string, max: number, windowSeconds: number) {
  const ok = await deps.db.rpc<boolean>('rate_limit_hit', { p_bucket: bucket, p_key: key, p_max: max, p_window_seconds: windowSeconds });
  if (!ok) {
    throw new HttpError(429, 'rate_limited', 'Too many requests. Please wait a little and try again.', undefined, {
      'Retry-After': String(windowSeconds),
    });
  }
}

/** Internal endpoints: Bearer CRON_SECRET or the service-role key. */
export function requireInternal(deps: Deps, req: Request) {
  const tok = bearer(req);
  const ok =
    !!tok &&
    ((deps.env.cronSecret.length >= 16 && safeEqual(tok, deps.env.cronSecret)) ||
      (deps.env.serviceRoleKey.length > 0 && safeEqual(tok, deps.env.serviceRoleKey)));
  if (!ok) throw new HttpError(401, 'unauthorized', 'Missing or wrong secret.');
}

/** Map P0001 errors raised by RPCs (message = code) to HTTP errors. */
export function rpcError(e: unknown, map: Record<string, [number, string]>): never {
  if (e instanceof DbError) {
    const key = Object.keys(map).find((k) => e.message.includes(k));
    if (key) throw new HttpError(map[key][0], key, map[key][1]);
  }
  throw e;
}

// ---------------------------------------------------------------- voice
export const filenameFor = (n: Pick<VoiceNoteRow, 'storage_path'>) => n.storage_path.split('/').pop() ?? 'audio.webm';

export type TranscribeOutcome =
  | { ok: true; text: string; language: string | null }
  | { ok: false; retryable: boolean; error: string };

/**
 * Download + transcribe one note within `budgetMs`, persisting the outcome.
 * Never throws for upstream problems: the note is rescheduled (or failed) instead.
 */
export async function transcribeNote(deps: Deps, note: Pick<VoiceNoteRow, 'id' | 'storage_path'>, budgetMs: number): Promise<TranscribeOutcome> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new DOMException('timeout', 'TimeoutError')), Math.max(budgetMs, 1000));
  try {
    const audio = await deps.storage.download(note.storage_path);
    if (!audio) {
      await deps.db.rpc('voice_mark_failed', { p_note_id: note.id, p_error: 'Audio file not found in storage (upload may not have finished).', p_retry_seconds: 60 });
      return { ok: false, retryable: true, error: 'audio_missing' };
    }
    const r = await deps.speech.transcribe(audio, filenameFor(note), ctl.signal);
    await deps.db.rpc('voice_save_transcript', { p_note_id: note.id, p_text: r.text, p_language: r.language, p_duration: r.duration });
    return { ok: true, text: r.text, language: r.language };
  } catch (e) {
    const up = e instanceof UpstreamError ? e : new UpstreamError(0, (e as Error)?.message ?? String(e));
    const retry = up.retryAfterSeconds ?? (up.status === 429 ? 60 : 30);
    await deps.db.rpc('voice_mark_failed', { p_note_id: note.id, p_error: up.message, p_retry_seconds: up.retryable ? retry : 600 });
    return { ok: false, retryable: up.retryable, error: up.message };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------- notifications
export function formatLeadMessage(l: LeadForNotify, adminUrl: string): string {
  const tierIcon = l.tier === 'ideal' ? '🟢' : l.tier === 'maybe' ? '🟡' : '⚪';
  const best = l.profile_matches[0];
  const lines = [
    `${tierIcon} <b>${l.tier === 'ideal' ? 'Ideal lead' : 'New lead'}</b> — ${escapeHtml(l.property_name)}`,
    `<b>${escapeHtml(l.name)}</b> · ${escapeHtml(formatPhone(l.phone_e164))}${l.whatsapp_ok ? ' (WhatsApp OK)' : ''}`,
    `Wants to: ${escapeHtml(l.path)}`,
  ];
  if (best) {
    lines.push(`Best match: <b>${escapeHtml(best.name)}</b> — ${best.match}%${best.qualified ? '' : ' (near miss)'}`);
    for (const m of best.matched.slice(0, 5)) lines.push(`✓ ${escapeHtml(m.text)}`);
    for (const m of best.failed_must.slice(0, 3)) lines.push(`✗ ${escapeHtml(m.text)}`);
    for (const m of best.missed.slice(0, 3)) lines.push(`– ${escapeHtml(m.text)}`);
  }
  lines.push(`Intent ${l.intent_score} · Priority ${l.priority}`);
  if (adminUrl) lines.push(`<a href="${escapeHtml(`${adminUrl}/admin/leads/${l.id}`)}">Open lead</a>`);
  const wa = `https://wa.me/${l.phone_e164.replace(/^\+/, '')}`;
  if (l.whatsapp_ok) lines.push(`<a href="${wa}">WhatsApp</a>`);
  return lines.join('\n');
}

/** Claim pending notifications (optionally for one response) and send them. */
export async function processNotifications(deps: Deps, responseId: string | null = null, limit = 10) {
  const rows = await deps.db.rpc<NotificationRow[]>('notification_claim', { p_limit: limit, p_response_id: responseId });
  let sent = 0;
  let failed = 0;
  for (const n of rows ?? []) {
    try {
      const lead = await deps.db.leadForNotify(n.response_id);
      if (!lead) throw new Error('lead not found');
      await deps.messenger.send(formatLeadMessage(lead, deps.env.adminAppUrl));
      await deps.db.rpc('notification_done', { p_id: n.id, p_ok: true, p_error: null });
      sent++;
    } catch (e) {
      failed++;
      await deps.db.rpc('notification_done', { p_id: n.id, p_ok: false, p_error: (e as Error)?.message ?? String(e) });
    }
  }
  return { sent, failed };
}
