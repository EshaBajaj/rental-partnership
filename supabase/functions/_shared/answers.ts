// Answer validation shared by the respondent UI (per screen) and the submit Edge Function
// (whole form, authoritative, against the form version the respondent used).

import type { CompiledQuestion, ContactValue, FormConfig, PathValue, RawAnswer, RawAnswers, StoredAnswer, StoredAnswers, Values } from './types.ts';
import { OTHER_VALUE, PATH_KEY, PATH_VALUES } from './types.ts';
import { evalShowIf, isAnswered } from './showif.ts';
import { normalisePhone } from './phone.ts';
import { effectiveMaxPicks, isSingleSelect, LIMITS, textMaxChars, withDefaults } from './input-modes.ts';

export type ErrorCode =
  | 'required'
  | 'invalid_option'
  | 'other_required'
  | 'too_long'
  | 'too_short'
  | 'too_few_picks'
  | 'too_many_picks'
  | 'not_a_number'
  | 'too_small'
  | 'too_large'
  | 'invalid_email'
  | 'invalid_date'
  | 'date_too_early'
  | 'date_too_late'
  | 'name_required'
  | 'invalid_phone'
  | 'consent_required'
  | 'hidden_answer'
  | 'unknown_question'
  | 'mode_disabled'
  | 'invalid_value';

export const ERROR_TEXT: Record<ErrorCode, { en: string; hi: string }> = {
  required: { en: 'Please answer this question.', hi: 'कृपया इस प्रश्न का उत्तर दें।' },
  invalid_option: { en: 'Please pick one of the options.', hi: 'कृपया दिए गए विकल्पों में से चुनें।' },
  other_required: { en: 'Please type your answer for “Other”.', hi: 'कृपया “अन्य” के लिए अपना उत्तर लिखें।' },
  too_long: { en: 'This answer is too long.', hi: 'यह उत्तर बहुत लंबा है।' },
  too_short: { en: 'Please write a little more.', hi: 'कृपया थोड़ा और लिखें।' },
  too_few_picks: { en: 'Please pick more options.', hi: 'कृपया और विकल्प चुनें।' },
  too_many_picks: { en: 'Please pick fewer options.', hi: 'कृपया कम विकल्प चुनें।' },
  not_a_number: { en: 'Please enter a number.', hi: 'कृपया एक संख्या दर्ज करें।' },
  too_small: { en: 'This number is too small.', hi: 'यह संख्या बहुत छोटी है।' },
  too_large: { en: 'This number is too large.', hi: 'यह संख्या बहुत बड़ी है।' },
  invalid_email: { en: 'Please enter a valid email address.', hi: 'कृपया सही ईमेल पता लिखें।' },
  invalid_date: { en: 'Please pick a valid date.', hi: 'कृपया सही तारीख चुनें।' },
  date_too_early: { en: 'This date is too early.', hi: 'यह तारीख बहुत पहले की है।' },
  date_too_late: { en: 'This date is too late.', hi: 'यह तारीख बहुत बाद की है।' },
  name_required: { en: 'Please enter your name.', hi: 'कृपया अपना नाम लिखें।' },
  invalid_phone: { en: 'Please enter a valid mobile number.', hi: 'कृपया सही मोबाइल नंबर लिखें।' },
  consent_required: { en: 'Please tick the box so we can contact you.', hi: 'कृपया बॉक्स पर टिक करें ताकि हम आपसे संपर्क कर सकें।' },
  hidden_answer: { en: 'This question should not have been answered.', hi: 'इस प्रश्न का उत्तर नहीं देना था।' },
  unknown_question: { en: 'Unknown question.', hi: 'अज्ञात प्रश्न।' },
  mode_disabled: { en: 'This way of answering is not available.', hi: 'इस तरह उत्तर देना उपलब्ध नहीं है।' },
  invalid_value: { en: 'This answer is not valid.', hi: 'यह उत्तर मान्य नहीं है।' },
};

export interface FieldError {
  key: string;
  code: ErrorCode;
  message: string;
}

export type One =
  | { ok: true; empty: true }
  | { ok: true; empty: false; stored: Omit<StoredAnswer, 'display' | 'question_label'>; display: string; voice: boolean; speech: { live: string | null; audio_missing: boolean } | null }
  | { ok: false; code: ErrorCode };

const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
export const formatCurrency = (n: number) => `₹${inr.format(n)}`;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const PENDING_VOICE_DISPLAY = '(voice note — transcription pending)';

function isValidDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** "45,000" / "₹ 4.5" → number, else null */
export function parseNumber(s: string): number | null {
  const c = s.replace(/[,\s₹]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(c)) return null;
  const n = Number(c);
  return Number.isFinite(n) ? n : null;
}

const optLabel = (q: CompiledQuestion, v: string) => q.options.find((o) => o.value === v)?.label_en ?? v;

function validateContact(raw: RawAnswer | undefined): One {
  const c = raw?.value as Partial<ContactValue> | null | undefined;
  if (!c || typeof c !== 'object' || Array.isArray(c)) return { ok: false, code: 'required' };
  const name = typeof c.name === 'string' ? c.name.trim().replace(/\s+/g, ' ') : '';
  if (name.length < 2) return { ok: false, code: 'name_required' };
  if (name.length > 80) return { ok: false, code: 'too_long' };
  const phone = typeof c.phone === 'string' ? normalisePhone(c.phone) : null;
  if (!phone) return { ok: false, code: 'invalid_phone' };
  if (c.consent !== true) return { ok: false, code: 'consent_required' };
  const whatsapp_ok = c.whatsapp_ok !== false;
  const value: ContactValue = { name, phone, whatsapp_ok, consent: true };
  return { ok: true, empty: false, stored: { value }, display: `${name} · ${phone}${whatsapp_ok ? ' · WhatsApp OK' : ''}`, voice: false, speech: null };
}

function validatePicks(q: CompiledQuestion, raw: RawAnswer | undefined, opts: { single: boolean; min: number | null; max: number | null; allowOther: boolean; otherMax: number }):
  { ok: true; picks: string[]; other?: string } | { ok: false; code: ErrorCode } {
  const picksRaw = raw?.choose;
  if (picksRaw == null) return { ok: true, picks: [] };
  if (!Array.isArray(picksRaw) || picksRaw.some((x) => typeof x !== 'string')) return { ok: false, code: 'invalid_option' };
  const picks = [...new Set(picksRaw)];
  for (const p of picks) {
    if (p === OTHER_VALUE && opts.allowOther) continue;
    if (!q.options.some((o) => o.value === p)) return { ok: false, code: 'invalid_option' };
  }
  if (picks.length === 0) return { ok: true, picks };
  if (opts.single && picks.length > 1) return { ok: false, code: 'too_many_picks' };
  if (opts.min != null && picks.length < opts.min) return { ok: false, code: 'too_few_picks' };
  if (opts.max != null && picks.length > opts.max) return { ok: false, code: 'too_many_picks' };
  let other: string | undefined;
  if (picks.includes(OTHER_VALUE)) {
    const t = (raw?.other_text ?? '').trim();
    if (!t) return { ok: false, code: 'other_required' };
    if (t.length > opts.otherMax) return { ok: false, code: 'too_long' };
    other = t;
  }
  // option order for stable display; "Other" last
  const ordered = [...q.options.map((o) => o.value).filter((x) => picks.includes(x)), ...(other ? [OTHER_VALUE] : [])];
  return { ok: true, picks: ordered, other };
}

const pickDisplay = (q: CompiledQuestion, picks: string[], other?: string) =>
  picks.map((p) => (p === OTHER_VALUE ? `Other: ${other}` : optLabel(q, p))).join(', ');

/**
 * Answers saved by an older version of the app (e.g. still waiting in a phone's offline outbox)
 * put everything in `value`. Convert them so they are never rejected and lost.
 */
export function upgradeRawAnswer(q: CompiledQuestion, raw: RawAnswer | undefined): RawAnswer | undefined {
  if (!raw || q.kind === 'contact' || raw.value === undefined || raw.value === null) return raw;
  const v = raw.value;
  const { value: _drop, ...rest } = raw;
  if (Array.isArray(v)) return { ...rest, choose: v };
  if (typeof v === 'number') return { ...rest, text: String(v) };
  if (typeof v === 'string') {
    if (q.kind === 'yes_no' || (q.input_modes?.choose.enabled && (q.options.some((o) => o.value === v) || v === OTHER_VALUE))) return { ...rest, choose: [v] };
    return { ...rest, text: v };
  }
  return raw;
}

/** Validate a single answer for a *visible* question. */
export function validateOne(q: CompiledQuestion, rawIn: RawAnswer | undefined): One {
  if (q.kind === 'contact') return validateContact(rawIn);
  const raw = upgradeRawAnswer(q, rawIn);

  if (q.kind === 'yes_no') {
    const r = validatePicks(q, raw, { single: true, min: null, max: 1, allowOther: false, otherMax: 0 });
    if (!r.ok) return r;
    if (!r.picks.length) return q.required ? { ok: false, code: 'required' } : { ok: true, empty: true };
    return { ok: true, empty: false, stored: { choose: r.picks }, display: pickDisplay(q, r.picks), voice: false, speech: null };
  }

  if (q.kind === 'date') {
    const t = (raw?.text ?? '').trim();
    if (!t) return q.required ? { ok: false, code: 'required' } : { ok: true, empty: true };
    if (!isValidDate(t)) return { ok: false, code: 'invalid_date' };
    const v = q.validation ?? {};
    if (typeof v.min === 'string' && v.min && t < v.min) return { ok: false, code: 'date_too_early' };
    if (typeof v.max === 'string' && v.max && t > v.max) return { ok: false, code: 'date_too_late' };
    return { ok: true, empty: false, stored: { text: t }, display: t, voice: false, speech: null };
  }

  // ---- standard: any combination of enabled modes may be answered
  const m = withDefaults(q.input_modes);
  const voice = !!raw?.voice && m.speak.enabled && m.speak.keep_audio;
  const speechRaw = raw?.speech && m.speak.enabled ? raw.speech : null;
  const speech = speechRaw ? { live: typeof speechRaw.live === 'string' ? speechRaw.live.slice(0, LIMITS.maxChars) : null, audio_missing: !!speechRaw.audio_missing } : null;
  const spoken = voice || !!(speech && (speech.live || speech.audio_missing));

  // choose
  let picks: string[] = [];
  let other: string | undefined;
  if (raw?.choose != null && raw.choose.length > 0) {
    if (!m.choose.enabled) return { ok: false, code: 'mode_disabled' };
    const r = validatePicks(q, raw, {
      single: isSingleSelect(m.choose),
      min: m.choose.min_picks,
      max: effectiveMaxPicks(m.choose),
      allowOther: m.choose.allow_other,
      otherMax: Math.min(m.choose.other_max_chars || 200, LIMITS.otherMaxChars),
    });
    if (!r.ok) return r;
    picks = r.picks;
    other = r.other;
  }

  // text (typed, or the transcript of a spoken answer)
  const text = typeof raw?.text === 'string' ? raw.text.trim() : '';
  let number: number | undefined;
  if (text) {
    if (!m.type.enabled && !spoken) return { ok: false, code: 'mode_disabled' };
    const max = textMaxChars(m);
    if (text.length > max) return { ok: false, code: 'too_long' };
    if (m.type.enabled && !spoken) {
      if (m.type.min_chars && text.length < m.type.min_chars) return { ok: false, code: 'too_short' };
      if (m.type.format === 'number' || m.type.format === 'currency') {
        const n = parseNumber(text);
        if (n === null) return { ok: false, code: 'not_a_number' };
        const v = q.validation ?? {};
        if (typeof v.min === 'number' && n < v.min) return { ok: false, code: 'too_small' };
        if (typeof v.max === 'number' && n > v.max) return { ok: false, code: 'too_large' };
        if (m.type.format === 'currency' && n < 0) return { ok: false, code: 'too_small' };
        if (Math.abs(n) > 1e12) return { ok: false, code: 'too_large' };
        number = n;
      }
      if (m.type.format === 'email' && !EMAIL_RE.test(text)) return { ok: false, code: 'invalid_email' };
    }
  }

  if (!picks.length && !text && !spoken) return q.required ? { ok: false, code: 'required' } : { ok: true, empty: true };

  const stored: Omit<StoredAnswer, 'display' | 'question_label'> = {};
  const parts: string[] = [];
  if (picks.length) {
    stored.choose = picks;
    if (other) stored.other_text = other;
    parts.push(pickDisplay(q, picks, other));
  }
  if (text) {
    stored.text = text;
    if (number !== undefined) {
      stored.number = number;
      parts.push(m.type.format === 'currency' ? formatCurrency(number) : inr.format(number));
    } else parts.push(text);
  } else if (spoken) {
    stored.text = '';
    parts.push(PENDING_VOICE_DISPLAY);
  }
  return { ok: true, empty: false, stored, display: parts.join(' — '), voice, speech: spoken ? (speech ?? { live: null, audio_missing: false }) : null };
}

/** Engine value of a stored answer (what show_if / profile conditions see). Mirrors SQL sls_values(). */
export function engineValue(a: Partial<StoredAnswer> | undefined): unknown {
  if (!a) return undefined;
  if (Array.isArray(a.choose) && a.choose.length) return a.choose;
  if (typeof a.number === 'number') return a.number;
  if (typeof a.text === 'string' && a.text.trim() !== '') return a.text;
  if (a.value !== undefined && a.value !== null && a.value !== '') return a.value; // legacy / contact
  if (a.voice_note_id) return '(voice note)';
  return undefined;
}

export function valuesFromStored(stored: StoredAnswers): Values {
  const out: Values = {};
  for (const [k, a] of Object.entries(stored)) out[k] = engineValue(a);
  return out;
}

/** Engine value for a raw (client-side) answer. */
export function rawEngineValue(r: RawAnswer | undefined): unknown {
  if (!r) return undefined;
  if (Array.isArray(r.choose) && r.choose.length) return r.choose;
  if (typeof r.text === 'string' && r.text.trim() !== '') {
    const n = parseNumber(r.text);
    return n ?? r.text;
  }
  if (typeof r.value === 'string' || typeof r.value === 'number') return r.value;
  if (Array.isArray(r.value) && r.value.length) return r.value;
  if (r.value) return r.value;
  if (r.voice || r.speech?.live || r.speech?.audio_missing) return '(voice note)';
  return undefined;
}

export interface VoiceMeta {
  final: string;
  live: string | null;
  audio_missing: boolean;
  has_audio: boolean;
}

export interface SubmissionResult {
  ok: boolean;
  errors: FieldError[];
  answers: StoredAnswers;
  visible: string[];
  /** Keys answered by speaking (with or without uploaded audio) */
  voice: Record<string, VoiceMeta>;
  path: PathValue | null;
  contact: { name: string; phone_e164: string; whatsapp_ok: boolean } | null;
}

export interface ValidateOptions {
  /** Server: reject answers to hidden questions. Client: silently drop them. */
  rejectHidden: boolean;
  lang?: 'en' | 'hi';
}

/** Validate a whole submission against a (normalised, schema-2) form config. */
export function validateSubmission(config: FormConfig, raw: RawAnswers, opts: ValidateOptions): SubmissionResult {
  const lang = opts.lang ?? 'en';
  const errors: FieldError[] = [];
  const answers: StoredAnswers = {};
  const effective: Values = {};
  const visible: string[] = [];
  const voice: Record<string, VoiceMeta> = {};
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
    const stored: StoredAnswer = { ...res.stored, display: res.display, question_label: q.label_en };
    answers[q.key] = stored;
    if (res.speech) {
      voice[q.key] = { final: stored.text ?? '', live: res.speech.live, audio_missing: res.speech.audio_missing, has_audio: res.voice };
    }
    effective[q.key] = engineValue(stored) ?? (res.speech ? '(voice note)' : undefined);
    if (q.kind === 'contact') {
      const c = stored.value as ContactValue;
      contact = { name: c.name, phone_e164: c.phone, whatsapp_ok: c.whatsapp_ok };
    }
  }
  const pv = answers[PATH_KEY]?.choose?.[0];
  const path = typeof pv === 'string' && (PATH_VALUES as readonly string[]).includes(pv) ? (pv as PathValue) : null;
  if (!path && !errors.some((e) => e.key === PATH_KEY)) push(PATH_KEY, 'required');
  if (!contact && !errors.some((e) => config.questions.find((q) => q.key === e.key)?.kind === 'contact')) {
    const cq = config.questions.find((q) => q.kind === 'contact');
    if (cq) push(cq.key, 'required');
  }
  return { ok: errors.length === 0, errors, answers, visible, voice, path, contact };
}
