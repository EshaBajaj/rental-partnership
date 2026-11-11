// Answer validation shared by the respondent UI (per screen) and the submit
// Edge Function (whole form, authoritative).

import type {
  AnswerValue,
  CompiledQuestion,
  ContactValue,
  FormConfig,
  PathValue,
  RawAnswer,
  RawAnswers,
  StoredAnswer,
  StoredAnswers,
  Values,
} from './types.ts';
import { OTHER_VALUE, PATH_KEY, PATH_VALUES, TEXT_DEFAULT_MAX, VOICE_LIMITS } from './types.ts';
import { evalShowIf, isAnswered } from './showif.ts';
import { normalisePhone } from './phone.ts';

export type ErrorCode =
  | 'required'
  | 'invalid_option'
  | 'other_required'
  | 'too_long'
  | 'too_few_picks'
  | 'too_many_picks'
  | 'not_a_number'
  | 'too_small'
  | 'too_large'
  | 'invalid_date'
  | 'date_too_early'
  | 'date_too_late'
  | 'name_required'
  | 'invalid_phone'
  | 'consent_required'
  | 'hidden_answer'
  | 'unknown_question'
  | 'invalid_value';

export const ERROR_TEXT: Record<ErrorCode, { en: string; hi: string }> = {
  required: { en: 'Please answer this question.', hi: 'कृपया इस प्रश्न का उत्तर दें।' },
  invalid_option: { en: 'Please pick one of the options.', hi: 'कृपया दिए गए विकल्पों में से चुनें।' },
  other_required: { en: 'Please type your answer for “Other”.', hi: 'कृपया “अन्य” के लिए अपना उत्तर लिखें।' },
  too_long: { en: 'This answer is too long.', hi: 'यह उत्तर बहुत लंबा है।' },
  too_few_picks: { en: 'Please pick more options.', hi: 'कृपया और विकल्प चुनें।' },
  too_many_picks: { en: 'Please pick fewer options.', hi: 'कृपया कम विकल्प चुनें।' },
  not_a_number: { en: 'Please enter a number.', hi: 'कृपया एक संख्या दर्ज करें।' },
  too_small: { en: 'This number is too small.', hi: 'यह संख्या बहुत छोटी है।' },
  too_large: { en: 'This number is too large.', hi: 'यह संख्या बहुत बड़ी है।' },
  invalid_date: { en: 'Please pick a valid date.', hi: 'कृपया सही तारीख चुनें।' },
  date_too_early: { en: 'This date is too early.', hi: 'यह तारीख बहुत पहले की है।' },
  date_too_late: { en: 'This date is too late.', hi: 'यह तारीख बहुत बाद की है।' },
  name_required: { en: 'Please enter your name.', hi: 'कृपया अपना नाम लिखें।' },
  invalid_phone: { en: 'Please enter a valid mobile number.', hi: 'कृपया सही मोबाइल नंबर लिखें।' },
  consent_required: { en: 'Please tick the box so we can contact you.', hi: 'कृपया बॉक्स पर टिक करें ताकि हम आपसे संपर्क कर सकें।' },
  hidden_answer: { en: 'This question should not have been answered.', hi: 'इस प्रश्न का उत्तर नहीं देना था।' },
  unknown_question: { en: 'Unknown question.', hi: 'अज्ञात प्रश्न।' },
  invalid_value: { en: 'This answer is not valid.', hi: 'यह उत्तर मान्य नहीं है।' },
};

export interface FieldError {
  key: string;
  code: ErrorCode;
  message: string;
}

type One =
  | { ok: true; empty: true }
  | { ok: true; empty: false; value: AnswerValue; display: string; other_text?: string; voice: boolean }
  | { ok: false; code: ErrorCode };

const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
export const formatCurrency = (n: number) => `₹${inr.format(n)}`;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const PENDING_VOICE_DISPLAY = '(voice note — transcription pending)';

function isValidDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function optLabel(q: CompiledQuestion, v: string): string {
  return q.options.find((o) => o.value === v)?.label_en ?? v;
}

/** Validate a single answer for a *visible* question. */
export function validateOne(q: CompiledQuestion, raw: RawAnswer | undefined): One {
  const val = raw?.value;
  const voice = !!raw?.voice && q.allow_voice;
  const v = q.validation ?? {};

  if (q.type === 'contact') {
    const c = val as Partial<ContactValue> | null | undefined;
    if (!c || typeof c !== 'object' || Array.isArray(c)) return { ok: false, code: 'required' };
    const name = typeof c.name === 'string' ? c.name.trim().replace(/\s+/g, ' ') : '';
    if (name.length < 2) return { ok: false, code: 'name_required' };
    if (name.length > 80) return { ok: false, code: 'too_long' };
    const phone = typeof c.phone === 'string' ? normalisePhone(c.phone) : null;
    if (!phone) return { ok: false, code: 'invalid_phone' };
    if (c.consent !== true) return { ok: false, code: 'consent_required' };
    const whatsapp_ok = c.whatsapp_ok !== false;
    const value: ContactValue = { name, phone, whatsapp_ok, consent: true };
    return { ok: true, empty: false, value, display: `${name} · ${phone}${whatsapp_ok ? ' · WhatsApp OK' : ''}`, voice: false };
  }

  // Empty?
  const emptyText = typeof val === 'string' && val.trim() === '';
  if (val === undefined || val === null || (Array.isArray(val) && val.length === 0) || (emptyText && !voice)) {
    return q.required ? { ok: false, code: 'required' } : { ok: true, empty: true };
  }

  switch (q.type) {
    case 'single':
    case 'dropdown':
    case 'yes_no': {
      if (typeof val !== 'string') return { ok: false, code: 'invalid_option' };
      if (val === OTHER_VALUE && q.allow_other) {
        const t = (raw?.other_text ?? '').trim();
        if (!t) return { ok: false, code: 'other_required' };
        if (t.length > 200) return { ok: false, code: 'too_long' };
        return { ok: true, empty: false, value: val, display: `Other: ${t}`, other_text: t, voice: false };
      }
      if (!q.options.some((o) => o.value === val)) return { ok: false, code: 'invalid_option' };
      return { ok: true, empty: false, value: val, display: optLabel(q, val), voice: false };
    }
    case 'multi': {
      if (!Array.isArray(val) || val.some((x) => typeof x !== 'string')) return { ok: false, code: 'invalid_option' };
      const picks = [...new Set(val as string[])];
      for (const p of picks) {
        if (p === OTHER_VALUE && q.allow_other) continue;
        if (!q.options.some((o) => o.value === p)) return { ok: false, code: 'invalid_option' };
      }
      const min = v.minPicks ?? (q.required ? 1 : 0);
      if (picks.length < min) return { ok: false, code: 'too_few_picks' };
      if (v.maxPicks != null && picks.length > v.maxPicks) return { ok: false, code: 'too_many_picks' };
      let other_text: string | undefined;
      if (picks.includes(OTHER_VALUE)) {
        const t = (raw?.other_text ?? '').trim();
        if (!t) return { ok: false, code: 'other_required' };
        if (t.length > 200) return { ok: false, code: 'too_long' };
        other_text = t;
      }
      // keep option order for stable display
      const ordered = [...q.options.map((o) => o.value).filter((x) => picks.includes(x)), ...(other_text ? [OTHER_VALUE] : [])];
      const display = ordered.map((p) => (p === OTHER_VALUE ? `Other: ${other_text}` : optLabel(q, p))).join(', ');
      return { ok: true, empty: false, value: ordered, display, other_text, voice: false };
    }
    case 'short_text':
    case 'long_text':
    case 'voice': {
      if (typeof val !== 'string') return { ok: false, code: 'invalid_value' };
      const t = val.trim();
      const max = voice ? VOICE_LIMITS.maxTranscriptChars : (v.maxLength ?? TEXT_DEFAULT_MAX[q.type]);
      if (t.length > max) return { ok: false, code: 'too_long' };
      if (!t && !voice) return q.required ? { ok: false, code: 'required' } : { ok: true, empty: true };
      return { ok: true, empty: false, value: t, display: t || PENDING_VOICE_DISPLAY, voice };
    }
    case 'number':
    case 'currency': {
      if (typeof val !== 'number' || !Number.isFinite(val)) return { ok: false, code: 'not_a_number' };
      if (typeof v.min === 'number' && val < v.min) return { ok: false, code: 'too_small' };
      if (typeof v.max === 'number' && val > v.max) return { ok: false, code: 'too_large' };
      if (q.type === 'currency' && val < 0) return { ok: false, code: 'too_small' };
      if (Math.abs(val) > 1e12) return { ok: false, code: 'too_large' };
      return { ok: true, empty: false, value: val, display: q.type === 'currency' ? formatCurrency(val) : inr.format(val), voice: false };
    }
    case 'date': {
      if (typeof val !== 'string' || !isValidDate(val)) return { ok: false, code: 'invalid_date' };
      if (typeof v.min === 'string' && v.min && val < v.min) return { ok: false, code: 'date_too_early' };
      if (typeof v.max === 'string' && v.max && val > v.max) return { ok: false, code: 'date_too_late' };
      return { ok: true, empty: false, value: val, display: val, voice: false };
    }
  }
  return { ok: false, code: 'invalid_value' };
}

/** Engine value for an answer (what show_if / profile conditions see). */
export function engineValue(a: { value: unknown; voice_note_id?: string } | undefined): unknown {
  if (!a) return undefined;
  if (a.value === '' && a.voice_note_id) return '(voice note)';
  return a.value;
}

export function valuesFromStored(stored: StoredAnswers): Values {
  const out: Values = {};
  for (const [k, a] of Object.entries(stored)) out[k] = engineValue(a);
  return out;
}

/** Value as the engines see it for a raw (client-side) answer. */
export function rawEngineValue(r: RawAnswer | undefined): unknown {
  if (!r) return undefined;
  if (typeof r.value === 'string' && r.value.trim() === '' && r.voice) return '(voice note)';
  return r.value;
}

export interface SubmissionResult {
  ok: boolean;
  errors: FieldError[];
  answers: StoredAnswers;
  visible: string[];
  /** Keys whose answers came from voice recordings. */
  voiceKeys: string[];
  path: PathValue | null;
  contact: { name: string; phone_e164: string; whatsapp_ok: boolean } | null;
}

export interface ValidateOptions {
  /** Server: reject answers to hidden questions. Client: silently drop them. */
  rejectHidden: boolean;
  lang?: 'en' | 'hi';
}

/** Validate a whole submission against a form config. */
export function validateSubmission(config: FormConfig, raw: RawAnswers, opts: ValidateOptions): SubmissionResult {
  const lang = opts.lang ?? 'en';
  const errors: FieldError[] = [];
  const answers: StoredAnswers = {};
  const effective: Values = {};
  const visible: string[] = [];
  const voiceKeys: string[] = [];
  const known = new Set(config.questions.map((q) => q.key));
  const push = (key: string, code: ErrorCode) => errors.push({ key, code, message: ERROR_TEXT[code][lang] });

  for (const k of Object.keys(raw ?? {})) if (!known.has(k)) push(k, 'unknown_question');

  let contact: SubmissionResult['contact'] = null;
  for (const q of config.questions) {
    const r = raw?.[q.key];
    if (!evalShowIf(q.show_if, effective)) {
      if (r !== undefined && opts.rejectHidden && isAnswered(rawEngineValue(r))) push(q.key, 'hidden_answer');
      continue;
    }
    visible.push(q.key);
    const res = validateOne(q, r);
    if (!res.ok) {
      push(q.key, res.code);
      continue;
    }
    if (res.empty) continue;
    const stored: StoredAnswer = { value: res.value, display: res.display, question_label: q.label_en };
    if (res.other_text) stored.other_text = res.other_text;
    answers[q.key] = stored;
    if (res.voice) voiceKeys.push(q.key);
    effective[q.key] = res.value === '' && res.voice ? '(voice note)' : res.value;
    if (q.type === 'contact') {
      const c = res.value as ContactValue;
      contact = { name: c.name, phone_e164: c.phone, whatsapp_ok: c.whatsapp_ok };
    }
  }
  const pv = answers[PATH_KEY]?.value;
  const path = typeof pv === 'string' && (PATH_VALUES as readonly string[]).includes(pv) ? (pv as PathValue) : null;
  if (!path && !errors.some((e) => e.key === PATH_KEY)) push(PATH_KEY, 'required');
  if (!contact && !errors.some((e) => config.questions.find((q) => q.key === e.key)?.type === 'contact')) {
    const cq = config.questions.find((q) => q.type === 'contact');
    if (cq) push(cq.key, 'required');
  }
  return { ok: errors.length === 0, errors, answers, visible, voiceKeys, path, contact };
}
