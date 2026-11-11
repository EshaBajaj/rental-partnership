// POST /submit → authoritative validation against the form version the client used,
// idempotent insert (client-generated id), matching, and ideal-lead notification.
import { clientIp, HttpError, json, readJson, serve } from '../_shared/server/http.ts';
import type { Deps } from '../_shared/server/deps.ts';
import { ipHash, processNotifications, rateLimit, rpcError } from '../_shared/server/core.ts';
import { SubmitBody } from '../_shared/schemas.ts';
import { ERROR_TEXT, validateOne, validateSubmission } from '../_shared/answers.ts';
import type { CompiledQuestion, ContactValue, StoredAnswers } from '../_shared/types.ts';
import { normalizeConfig } from '../_shared/input-modes.ts';

const WAITLIST_CONTACT: CompiledQuestion = {
  key: 'contact', kind: 'contact', label_en: 'Contact', label_hi: null, help_en: null, help_hi: null,
  required: true, show_if: null, validation: {}, input_modes: null, options: [],
};

export function makeHandler(deps: Deps) {
  return serve(['POST'], deps.env.allowedOrigins, async (req) => {
    const b = await readJson(req, SubmitBody);

    // Idempotent retry: an already-stored id returns success without counting against rate limits.
    const existing = await deps.db.responseExists(b.id);
    if (existing) return json({ id: b.id, status: 'existing' });

    // Honeypot: pretend success, store nothing.
    if (b.website && b.website.trim() !== '') return json({ id: b.id, status: 'created' });

    const ip = await ipHash(deps, clientIp(req));
    await rateLimit(deps, 'submit', ip, 5, 3600);

    const p = await deps.db.propertyBySlug(b.property_slug);
    if (!p) throw new HttpError(404, 'not_found', 'Unknown form.');

    let payload: Record<string, unknown>;
    if (b.waitlist) {
      const r = validateOne(WAITLIST_CONTACT, b.answers.contact);
      if (!r.ok || r.empty) {
        const code = r.ok ? 'required' : r.code;
        throw new HttpError(422, 'validation', ERROR_TEXT[code][b.lang], [{ key: 'contact', code, message: ERROR_TEXT[code][b.lang] }]);
      }
      const c = r.stored.value as ContactValue;
      const answers: StoredAnswers = { contact: { ...r.stored, display: r.display, question_label: 'Contact' } };
      payload = {
        path: 'waitlist', answers, voice: {}, name: c.name, phone_e164: c.phone, whatsapp_ok: c.whatsapp_ok,
        form_version_id: null,
      };
    } else {
      if (p.status !== 'open') throw new HttpError(409, 'closed', 'This form is closed. You can join the waitlist instead.');
      if (!b.form_version_id) throw new HttpError(400, 'bad_request', 'form_version_id is required.');
      const fv = await deps.db.formVersion(b.form_version_id, p.id);
      if (!fv) throw new HttpError(409, 'form_changed', 'The form has changed. Please reload.');
      // validate against the exact version the respondent used (older versions are upgraded on read)
      const v = validateSubmission(normalizeConfig(fv.config), b.answers, { rejectHidden: true, lang: b.lang });
      if (!v.ok || !v.contact || !v.path) {
        throw new HttpError(422, 'validation', v.errors[0]?.message ?? 'Please check your answers.', v.errors);
      }
      payload = {
        path: v.path, answers: v.answers, voice: v.voice, name: v.contact.name, phone_e164: v.contact.phone_e164,
        whatsapp_ok: v.contact.whatsapp_ok, form_version_id: fv.id,
      };
    }

    let res: { status: 'created' | 'existing'; id: string; notify?: boolean };
    try {
      res = await deps.db.rpc('submit_response', {
        p: {
          ...payload,
          id: b.id,
          property_id: p.id,
          lang: b.lang,
          source: b.source,
          duration_seconds: b.duration_seconds,
          ip_hash: ip,
        },
      });
    } catch (e) {
      rpcError(e, {
        id_conflict: [409, 'Please reload the form and try again.'],
        unknown_form_version: [409, 'The form has changed. Please reload.'],
      });
    }
    if (res.notify) deps.waitUntil(processNotifications(deps, res.id));
    return json({ id: res.id, status: res.status }, res.status === 'created' ? 201 : 200);
  });
}
