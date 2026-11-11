import { useEffect, useRef, useState } from 'react';
import type { CompiledQuestion, RawAnswer } from '@shared/types.ts';
import { VOICE_LIMITS } from '@shared/types.ts';
import { ApiError, track, transcribeNow, uploadAudio, voiceUploadUrl } from './api.ts';
import { type Recording, startRecording, voiceSupported } from './recorder.ts';
import { type Lang, t } from './i18n.ts';

export interface VoiceCtx {
  slug: string;
  responseId: string;
  formVersionId: string;
}

type Phase = 'idle' | 'recording' | 'uploading' | 'transcribing' | 'review' | 'pending' | 'error';

const MAX_SECONDS = 120;

interface Props {
  q: CompiledQuestion;
  lang: Lang;
  value: RawAnswer | undefined;
  onChange: (a: RawAnswer) => void;
  ctx: VoiceCtx;
  uploads: number;
  onUploaded: (pending: boolean) => void;
  onBusy: (busy: boolean) => void;
  placeholder: string;
  multiline: boolean;
  voiceFirst: boolean;
}

export function VoiceAnswer({ q, lang, value, onChange, ctx, uploads, onUploaded, onBusy, placeholder, multiline, voiceFirst }: Props) {
  const hasVoice = !!value?.voice;
  const [phase, setPhase] = useState<Phase>(hasVoice ? 'review' : 'idle');
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Awaited<ReturnType<typeof startRecording>> | null>(null);
  const lastRecording = useRef<Recording | null>(null);
  const text = typeof value?.value === 'string' ? value.value : '';
  const left = VOICE_LIMITS.maxRecordingsPerQuestion - uploads;
  const busy = phase === 'recording' || phase === 'uploading' || phase === 'transcribing';

  useEffect(() => onBusy(busy), [busy, onBusy]);
  useEffect(() => () => rec.current?.cancel(), []);

  async function begin() {
    setError(null);
    if (!voiceSupported()) {
      setError(t(lang, 'micUnsupported'));
      return;
    }
    try {
      setSeconds(0);
      rec.current = await startRecording(MAX_SECONDS, setSeconds);
      setPhase('recording');
      track(ctx.slug, ctx.responseId, { event: 'voice_start', question_key: q.key });
    } catch (e) {
      setPhase('error');
      setError((e as Error)?.name === 'NotAllowedError' ? t(lang, 'micDenied') : t(lang, 'micUnsupported'));
    }
  }

  async function finish() {
    if (!rec.current) return;
    try {
      const r = await rec.current.stop();
      rec.current = null;
      if (r.seconds < 1 || r.blob.size < 500) {
        setPhase(hasVoice ? 'review' : 'idle');
        setError(t(lang, 'tooShort'));
        return;
      }
      lastRecording.current = r;
      await send(r);
    } catch {
      setPhase('error');
      setError(t(lang, 'micUnsupported'));
    }
  }

  async function send(r: Recording) {
    setError(null);
    setPhase('uploading');
    try {
      const up = await voiceUploadUrl({
        property_slug: ctx.slug,
        response_id: ctx.responseId,
        form_version_id: ctx.formVersionId,
        question_key: q.key,
        mime: r.mime,
        bytes: r.blob.size,
        duration_seconds: Math.max(0.5, Math.round(r.seconds * 10) / 10),
      });
      await uploadAudio(up.signed_url, r.blob, r.mime);
    } catch (e) {
      setPhase('error');
      const err = e as ApiError;
      setError(err.status === 409 || err.status === 413 || err.status === 415 ? err.message : t(lang, 'uploadFailed'));
      return;
    }
    // Recording is safely stored. From here on the answer counts even if transcription fails.
    onChange({ value: text, voice: true });
    onUploaded(true);
    lastRecording.current = null;
    setPhase('transcribing');
    try {
      const res = await transcribeNow(ctx.responseId, q.key);
      if ('pending' in res) {
        setPhase('pending');
      } else {
        onChange({ value: res.text.slice(0, VOICE_LIMITS.maxTranscriptChars), voice: true });
        onUploaded(false);
        setPhase('review');
      }
      track(ctx.slug, ctx.responseId, { event: 'voice_sent', question_key: q.key });
    } catch {
      setPhase('pending');
    }
  }

  function removeRecording() {
    onChange({ value: text, voice: false });
    setPhase('idle');
  }

  const field = multiline ? (
    <textarea
      className="input min-h-32 resize-y"
      value={text}
      maxLength={hasVoice ? VOICE_LIMITS.maxTranscriptChars : (q.validation.maxLength ?? (q.type === 'short_text' ? 200 : 2000))}
      placeholder={placeholder}
      disabled={busy}
      aria-label={lang === 'hi' && q.label_hi ? q.label_hi : q.label_en}
      onChange={(e) => onChange({ value: e.target.value, voice: hasVoice })}
    />
  ) : (
    <input
      className="input"
      value={text}
      maxLength={hasVoice ? VOICE_LIMITS.maxTranscriptChars : (q.validation.maxLength ?? 200)}
      placeholder={placeholder}
      disabled={busy}
      aria-label={lang === 'hi' && q.label_hi ? q.label_hi : q.label_en}
      onChange={(e) => onChange({ value: e.target.value, voice: hasVoice })}
    />
  );

  const mic = (
    <div className="flex flex-col items-center gap-2">
      {phase === 'recording' ? (
        <button type="button" onClick={finish} className="flex h-24 w-24 items-center justify-center rounded-full bg-red-600 text-white shadow-lg ring-8 ring-red-100 animate-pulse" aria-label={t(lang, 'recording')}>
          <span className="h-8 w-8 rounded-md bg-white" />
        </button>
      ) : (
        <button
          type="button"
          onClick={begin}
          disabled={busy || left <= 0}
          className="flex h-24 w-24 items-center justify-center rounded-full bg-brand-700 text-white shadow-lg ring-8 ring-brand-100 disabled:opacity-40"
          aria-label={t(lang, 'speak')}
        >
          <svg viewBox="0 0 24 24" className="h-10 w-10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <rect x="9" y="2" width="6" height="12" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0M12 18v4" />
          </svg>
        </button>
      )}
      <p className="text-sm text-stone-600" aria-live="polite">
        {phase === 'recording'
          ? `${t(lang, 'recording')} · ${Math.floor(seconds)}s / ${MAX_SECONDS}s`
          : phase === 'uploading'
            ? t(lang, 'uploading')
            : phase === 'transcribing'
              ? t(lang, 'transcribing')
              : hasVoice
                ? `${t(lang, 'rerecord')} · ${t(lang, 'recordingsLeft', { n: Math.max(left, 0) })}`
                : `${t(lang, 'speak')} · ${t(lang, 'maxLength', { s: MAX_SECONDS })}`}
      </p>
    </div>
  );

  return (
    <div className="space-y-4">
      {(voiceFirst || phase !== 'idle') && mic}
      {!voiceFirst && phase === 'idle' && (
        <button type="button" className="btn-secondary w-full" onClick={begin} disabled={left <= 0}>
          🎤 {t(lang, 'speak')}
        </button>
      )}
      {error && (
        <div role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">
          {error}
          {phase === 'error' && lastRecording.current && (
            <button type="button" className="ml-2 font-semibold underline" onClick={() => lastRecording.current && send(lastRecording.current)}>
              {t(lang, 'retry')}
            </button>
          )}
        </div>
      )}
      {phase === 'pending' && <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{t(lang, 'pending')}</div>}
      {phase === 'review' && <p className="text-sm font-medium text-brand-800">{t(lang, 'reviewTranscript')}</p>}
      {(phase === 'transcribing' || phase === 'uploading') && (
        <div className="h-2 overflow-hidden rounded-full bg-stone-200">
          <div className="h-full w-1/3 animate-[pulse_1s_ease-in-out_infinite] rounded-full bg-brand-500" />
        </div>
      )}
      {voiceFirst && phase === 'idle' && <p className="text-center text-sm text-stone-500">{t(lang, 'orType')}</p>}
      {field}
      {hasVoice && !busy && (
        <button type="button" className="text-sm text-stone-500 underline" onClick={removeRecording}>
          {t(lang, 'deleteRecording')}
        </button>
      )}
    </div>
  );
}
