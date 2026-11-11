// zod request schemas for the Edge Functions. The web app imports these types
// for its API client but avoids pulling zod into the respondent bundle (type-only imports).
import { z } from 'zod';
import { VOICE_MIME_TYPES } from './types.ts';

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
  duration_seconds: z.number().min(0.5).max(300),
});
export type VoiceUploadBody = z.infer<typeof VoiceUploadBody>;

export const TranscribeNowBody = z.object({
  response_id: uuid,
  question_key: key,
});
export type TranscribeNowBody = z.infer<typeof TranscribeNowBody>;

const contactValue = z.object({
  name: z.string().max(200),
  phone: z.string().max(40),
  whatsapp_ok: z.boolean(),
  consent: z.boolean(),
});

const answerValue = z.union([z.string().max(5000), z.number(), z.array(z.string().max(100)).max(50), contactValue]);

export const RawAnswerSchema = z.object({
  value: answerValue.nullable(),
  other_text: z.string().max(500).nullable().optional(),
  voice: z.boolean().optional(),
});

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
