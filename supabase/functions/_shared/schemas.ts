// zod request schemas for the Edge Functions. The web app imports these types
// for its API client but avoids pulling zod into the respondent bundle (type-only imports).
import { z } from 'zod';
import { CHOOSE_STYLES, INPUT_MODES, QUESTION_KINDS, TEXT_FORMATS, VOICE_MIME_TYPES } from './types.ts';
import { LIMITS } from './input-modes.ts';

const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/);
const key = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);
const uuid = z.string().uuid();

export const FormQuery = z.object({ slug });

export const TrackBody = z.object({
  property_slug: slug,
  session_id: uuid,
  events: z
    .array(
      z.object({
        event: z.enum(['view', 'start', 'answer', 'back', 'voice_start', 'voice_sent', 'submit_attempt', 'submit_ok', 'submit_error', 'abandon']),
        question_key: key.optional(),
        ms: z.number().int().min(0).max(86_400_000).optional(),
      }),
    )
    .min(1)
    .max(50),
});
export type TrackBody = z.infer<typeof TrackBody>;

export const VoiceUploadBody = z.object({
  property_slug: slug,
  response_id: uuid,
  form_version_id: uuid,
  question_key: key,
  mime: z.enum(VOICE_MIME_TYPES),
  bytes: z.number().int().positive().max(10 * 1024 * 1024),
  duration_seconds: z.number().min(0.5).max(LIMITS.speakMaxSeconds + 5),
});
export type VoiceUploadBody = z.infer<typeof VoiceUploadBody>;

export const TranscribeNowBody = z.object({
  response_id: uuid,
  question_key: key,
});
export type TranscribeNowBody = z.infer<typeof TranscribeNowBody>;

// ---------------------------------------------------------------- input modes (question config)
const nullableInt = (min: number, max: number) => z.number().int().min(min).max(max).nullable();
export const InputModesSchema = z
  .object({
    primary: z.enum(INPUT_MODES),
    choose: z.object({
      enabled: z.boolean(),
      style: z.enum(CHOOSE_STYLES),
      min_picks: nullableInt(0, LIMITS.maxPicks),
      max_picks: nullableInt(1, LIMITS.maxPicks),
      allow_other: z.boolean(),
      other_max_chars: z.number().int().min(1).max(LIMITS.otherMaxChars),
    }),
    type: z.object({
      enabled: z.boolean(),
      multiline: z.boolean(),
      min_chars: nullableInt(0, LIMITS.maxChars),
      max_chars: nullableInt(1, LIMITS.maxChars),
      placeholder_en: z.string().max(120).nullable(),
      placeholder_hi: z.string().max(120).nullable(),
      format: z.enum(TEXT_FORMATS),
    }),
    speak: z.object({
      enabled: z.boolean(),
      max_seconds: z.number().int().min(LIMITS.speakMinSeconds).max(LIMITS.speakMaxSeconds),
      live_transcript: z.boolean(),
      allow_edit: z.boolean(),
      keep_audio: z.boolean(),
    }),
  })
  .superRefine((m, ctx) => {
    if (!m.choose.enabled && !m.type.enabled && !m.speak.enabled) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Turn on at least one way to answer (Choose, Type or Speak).' });
    }
    if (!m[m.primary].enabled) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['primary'], message: 'The main way to answer must be switched on.' });
    if (m.type.min_chars != null && m.type.max_chars != null && m.type.min_chars > m.type.max_chars) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['type', 'min_chars'], message: 'Minimum characters is bigger than the maximum.' });
    }
    if (m.choose.min_picks != null && m.choose.max_picks != null && m.choose.min_picks > m.choose.max_picks) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['choose', 'min_picks'], message: '“Pick at least” is bigger than “pick at most”.' });
    }
  });
export type InputModesInput = z.infer<typeof InputModesSchema>;
export const QuestionKindSchema = z.enum(QUESTION_KINDS);

const contactValue = z.object({
  name: z.string().max(200),
  phone: z.string().max(40),
  whatsapp_ok: z.boolean(),
  consent: z.boolean(),
});

export const RawAnswerSchema = z
  .object({
    choose: z.array(z.string().max(100)).max(LIMITS.maxPicks).nullable().optional(),
    other_text: z.string().max(LIMITS.otherMaxChars + 100).nullable().optional(),
    text: z.string().max(LIMITS.maxChars + 1000).nullable().optional(),
    voice: z.boolean().optional(),
    speech: z.object({ live: z.string().max(LIMITS.maxChars + 1000).nullable().optional(), audio_missing: z.boolean().optional() }).nullable().optional(),
    // contact details; legacy (pre input-modes) clients sent every answer here
    value: z.union([contactValue, z.string().max(5000), z.number(), z.array(z.string().max(100)).max(50)]).nullable().optional(),
  })
  .strict();

export const SubmitBody = z.object({
  id: uuid,
  property_slug: slug,
  form_version_id: uuid.nullable(),
  waitlist: z.boolean().default(false),
  answers: z.record(key, RawAnswerSchema),
  lang: z.enum(['en', 'hi']).default('en'),
  source: z.string().max(60).default('qr'),
  duration_seconds: z.number().int().min(0).max(7 * 86400),
  /** honeypot — must be empty */
  website: z.string().max(200).optional().default(''),
});
export type SubmitBody = z.infer<typeof SubmitBody>;

export const NotifyBody = z.object({ response_id: uuid, kind: z.enum(['ideal_lead', 'test']).default('ideal_lead') });
export type NotifyBody = z.infer<typeof NotifyBody>;
