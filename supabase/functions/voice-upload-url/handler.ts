// POST /voice-upload-url → validates limits, records the note as 'uploading', returns a signed upload URL.
import { clientIp, HttpError, json, readJson, serve } from '../_shared/server/http.ts';
import type { Deps } from '../_shared/server/deps.ts';
import { ipHash, rateLimit, rpcError } from '../_shared/server/core.ts';
import { VoiceUploadBody } from '../_shared/schemas.ts';
import { VOICE_LIMITS } from '../_shared/types.ts';

export function makeHandler(deps: Deps) {
  return serve(['POST'], deps.env.allowedOrigins, async (req) => {
    const b = await readJson(req, VoiceUploadBody);
    if (b.bytes > VOICE_LIMITS.maxBytes) throw new HttpError(413, 'too_large', 'Recording is larger than 10 MB.');
    const ip = await ipHash(deps, clientIp(req));
    await rateLimit(deps, 'voice-ip', ip, 40, 3600);
    await rateLimit(deps, 'voice-resp', b.response_id, 15, 3600);

    const p = await deps.db.propertyBySlug(b.property_slug);
    if (!p) throw new HttpError(404, 'not_found', 'Unknown form.');
    if (p.status !== 'open') throw new HttpError(409, 'closed', 'This form is closed.');
    const fv = await deps.db.formVersion(b.form_version_id, p.id);
    if (!fv) throw new HttpError(409, 'form_changed', 'The form has changed. Please reload.');
    const q = fv.config.questions.find((x) => x.key === b.question_key);
    if (!q || !q.allow_voice) throw new HttpError(400, 'voice_not_allowed', 'This question does not accept voice answers.');

    let prep: { path: string; previous_path: string | null };
    try {
      prep = await deps.db.rpc('voice_prepare_upload', {
        p_property_id: p.id,
        p_response_id: b.response_id,
        p_question_key: b.question_key,
        p_mime: b.mime,
        p_bytes: b.bytes,
        p_duration: Math.round(b.duration_seconds * 10) / 10,
      });
    } catch (e) {
      rpcError(e, {
        too_many_recordings: [409, 'You can record up to 3 times for each question.'],
        audio_limit: [409, 'You have used the 5 minutes of recording time for this form.'],
        already_submitted: [409, 'This form was already sent.'],
        id_conflict: [409, 'Please reload the form.'],
        bad_mime: [415, 'This audio format is not supported.'],
      });
    }
    const signed = await deps.storage.createSignedUploadUrl(prep.path);
    if (prep.previous_path && prep.previous_path !== prep.path) {
      deps.waitUntil(deps.storage.remove([prep.previous_path]));
    }
    return json({ path: prep.path, signed_url: signed.signedUrl, token: signed.token });
  });
}
