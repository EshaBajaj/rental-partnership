// POST /transcribe-worker (pg_cron every minute, Bearer CRON_SECRET):
//  1. transcribe recordings that missed the synchronous path (retries with backoff)
//  2. translate non-English final transcripts to English
//  3. retry pending notifications
//  4. delete audio past the retention period (transcripts are kept)
import { json, serve } from '../_shared/server/http.ts';
import { type Deps, UpstreamError, type VoiceNoteRow } from '../_shared/server/deps.ts';
import { processNotifications, requireInternal, transcribeNote } from '../_shared/server/core.ts';

export const RUN_BUDGET_MS = 50_000;

export function makeHandler(deps: Deps) {
  return serve(['POST'], deps.env.allowedOrigins, async (req) => {
    requireInternal(deps, req);
    return json(await runWorker(deps));
  });
}

export async function runWorker(deps: Deps) {
  const started = deps.now();
  const left = () => RUN_BUDGET_MS - (deps.now() - started);
  const out = { transcribed: 0, transcribe_failed: 0, translated: 0, translate_failed: 0, notified: 0, notify_failed: 0, audio_deleted: 0, errors: [] as string[] };
  await deps.db.heartbeat('transcribe-worker').catch((e) => out.errors.push(`heartbeat: ${e.message}`));

  // 1. transcription
  try {
    const notes = await deps.db.rpc<VoiceNoteRow[]>('voice_claim_transcribe', { p_limit: 5 });
    for (const n of notes ?? []) {
      if (left() < 5_000) break;
      const r = await transcribeNote(deps, n, Math.min(25_000, left() - 2_000));
      if (r.ok) out.transcribed++;
      else out.transcribe_failed++;
    }
  } catch (e) {
    out.errors.push(`transcribe: ${(e as Error).message}`);
  }

  // 2. translation
  try {
    const notes = left() > 5_000 ? await deps.db.rpc<VoiceNoteRow[]>('voice_claim_translate', { p_limit: 5 }) : [];
    for (const n of notes ?? []) {
      if (left() < 4_000) break;
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), Math.min(15_000, left() - 2_000));
      try {
        const text = (n.transcript_final ?? n.transcript_machine ?? '').trim();
        const en = await deps.speech.translateToEnglish(text, ctl.signal);
        await deps.db.rpc('voice_save_translation', { p_note_id: n.id, p_text: en });
        out.translated++;
      } catch (e) {
        out.translate_failed++;
        out.errors.push(`translate ${n.id}: ${e instanceof UpstreamError ? e.message : (e as Error).message}`);
      } finally {
        clearTimeout(timer);
      }
    }
  } catch (e) {
    out.errors.push(`translate: ${(e as Error).message}`);
  }

  // 3. notifications
  try {
    if (left() > 3_000) {
      const r = await processNotifications(deps, null, 10);
      out.notified = r.sent;
      out.notify_failed = r.failed;
    }
  } catch (e) {
    out.errors.push(`notify: ${(e as Error).message}`);
  }

  // 4. retention
  try {
    if (left() > 3_000) {
      const expired = await deps.db.rpc<{ id: string; storage_path: string }[]>('audio_expired', { p_limit: 50 });
      if (expired?.length) {
        await deps.storage.remove(expired.map((x) => x.storage_path));
        await deps.db.rpc('audio_mark_deleted', { p_ids: expired.map((x) => x.id) });
        out.audio_deleted = expired.length;
      }
    }
  } catch (e) {
    out.errors.push(`retention: ${(e as Error).message}`);
  }
  return out;
}
