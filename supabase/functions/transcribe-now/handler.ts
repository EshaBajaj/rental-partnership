// POST /transcribe-now → synchronous transcription for the respondent (15 s budget).
// On timeout / 429 / 5xx the note is rescheduled for the worker and {pending:true} is returned.
import { clientIp, json, readJson, serve } from '../_shared/server/http.ts';
import type { Deps } from '../_shared/server/deps.ts';
import { ipHash, rateLimit, rpcError, transcribeNote } from '../_shared/server/core.ts';
import { TranscribeNowBody } from '../_shared/schemas.ts';

export const BUDGET_MS = 15_000;

export function makeHandler(deps: Deps) {
  return serve(['POST'], deps.env.allowedOrigins, async (req) => {
    const started = deps.now();
    const b = await readJson(req, TranscribeNowBody);
    const ip = await ipHash(deps, clientIp(req));
    await rateLimit(deps, 'transcribe-ip', ip, 30, 600);
    await rateLimit(deps, 'transcribe-resp', b.response_id, 12, 3600);

    let note: { done: boolean; text?: string; language?: string | null; id?: string; storage_path?: string };
    try {
      note = await deps.db.rpc('voice_begin_transcribe', { p_response_id: b.response_id, p_question_key: b.question_key });
    } catch (e) {
      rpcError(e, {
        not_found: [404, 'Recording not found. Please record again.'],
        too_many_attempts: [429, 'We could not transcribe this recording. You can type your answer instead.'],
      });
    }
    if (note.done) return json({ text: note.text ?? '', language: note.language ?? null });

    const remaining = BUDGET_MS - (deps.now() - started) - 1000;
    const out = await transcribeNote(deps, { id: note.id!, storage_path: note.storage_path! }, remaining);
    if (out.ok) return json({ text: out.text, language: out.language });
    return json({ pending: true });
  });
}
