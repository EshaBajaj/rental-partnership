// Answer by speaking. While recording, the browser's speech service shows the words live
// (final words in ink, interim words muted); audio is recorded in parallel. After stopping the
// text becomes editable ("This is exactly what we'll receive"). If the audio is kept, it is
// uploaded and transcribed by Whisper in the background; a clearer version is OFFERED, never
// applied automatically. Browsers without live speech fall back to record → "Writing it down…".
import { useEffect, useRef, useState } from 'react';
import type { CompiledQuestion, RawAnswer, SpeakMode } from '@shared/types.ts';
import { VOICE_LIMITS } from '@shared/types.ts';
import { ApiError, track, transcribeNow, uploadAudio, voiceUploadUrl } from './api.ts';
import { type Recording, startRecording, voiceSupported } from './recorder.ts';
import { getRecognitionCtor, isNearSilent, joinTranscript, shouldOfferClearerVersion, speechLangFor, type SpeechRecognitionLike } from './speech.ts';
import { type Lang, t } from './i18n.ts';
import { Icon } from '../lib/icons.tsx';

export interface VoiceCtx {
  slug: string;
  responseId: string;
  formVersionId: string;
  speechLang?: 'hi-IN' | 'en-IN';
  /** builder preview: no microphone, no network */
  preview?: boolean;
}

type Phase = 'idle' | 'recording' | 'review';
type Audio = 'none' | 'uploading' | 'uploaded' | 'failed' | 'missing';
type Whisper = 'idle' | 'working' | 'done' | 'pending';

interface Props {
  q: CompiledQuestion;
  speak: SpeakMode;
  maxChars: number;
  lang: Lang;
  value: RawAnswer | undefined;
  onChange: (a: RawAnswer) => void;
  ctx: VoiceCtx;
  uploads: number;
  onUploaded: (pending: boolean) => void;
  onBusy: (busy: boolean) => void;
}

export function SpeakAnswer({ q, speak, maxChars, lang, value, onChange, ctx, uploads, onUploaded, onBusy }: Props) {
  const hadAnswer = !!(value?.voice || value?.speech);
  const [phase, setPhase] = useState<Phase>(hadAnswer ? 'review' : 'idle');
  const [seconds, setSeconds] = useState(0);
  const [live, setLive] = useState({ final: '', interim: '' });
  const [audio, setAudio] = useState<Audio>(value?.voice ? 'uploaded' : value?.speech?.audio_missing ? 'missing' : 'none');
  const [whisper, setWhisper] = useState<Whisper>('idle');
  const [offer, setOffer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [speechLang, setSpeechLang] = useState<'hi-IN' | 'en-IN'>(speechLangFor(null, ctx.speechLang));

  const recRef = useRef<Awaited<ReturnType<typeof startRecording>> | null>(null);
  const recogRef = useRef<SpeechRecognitionLike | null>(null);
  const recordingRef = useRef(false);
  const finalsRef = useRef<string[]>([]);
  const interimRef = useRef('');
  const captureFailed = useRef(false);
  const liveFailed = useRef(false);
  const editedRef = useRef(false);
  const lastRecording = useRef<Recording | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const Ctor = getRecognitionCtor();
  const liveOn = speak.live_transcript && !!Ctor;
  const canSpeak = !ctx.preview ? (liveOn || (speak.keep_audio && voiceSupported())) : true;
  const left = VOICE_LIMITS.maxRecordingsPerQuestion - uploads;
  const busy = phase === 'recording' || audio === 'uploading' || (whisper === 'working' && !(valueRef.current?.text ?? '').trim());
  const text = typeof value?.text === 'string' ? value.text : '';

  useEffect(() => onBusy(busy), [busy, onBusy]);
  useEffect(
    () => () => {
      recordingRef.current = false;
      recRef.current?.cancel();
      try {
        recogRef.current?.abort();
      } catch {
        /* ignore */
      }
      if (stopTimer.current) clearTimeout(stopTimer.current);
    },
    [],
  );

  function emit(patch: Partial<RawAnswer>) {
    const cur = valueRef.current ?? {};
    const next = { ...cur, ...patch };
    valueRef.current = next;
    onChange(next);
  }

  function startRecognition() {
    if (!Ctor || !speak.live_transcript) return;
    const r = new Ctor();
    r.lang = speechLang;
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const tr = res[0]?.transcript ?? '';
        if (res.isFinal) finalsRef.current.push(tr.trim());
        else interim += tr;
      }
      interimRef.current = interim;
      setLive(joinTranscript(finalsRef.current, interim));
    };
    r.onerror = (e) => {
      if (e.error === 'audio-capture') captureFailed.current = true;
      if (['not-allowed', 'service-not-allowed', 'network', 'language-not-supported', 'audio-capture'].includes(e.error)) liveFailed.current = true;
    };
    r.onend = () => {
      // Chrome ends recognition after silences; keep listening while we are recording.
      if (recordingRef.current && !liveFailed.current) {
        try {
          r.start();
        } catch {
          /* already started */
        }
      }
    };
    recogRef.current = r;
    try {
      r.start();
    } catch {
      liveFailed.current = true;
    }
  }

  async function begin() {
    setError(null);
    setOffer(null);
    if (ctx.preview) {
      setPhase('review');
      emit({ text: lang === 'hi' ? 'उत्तरदाता के शब्द यहाँ बोलते ही दिखेंगे।' : "The respondent's words appear here as they speak.", speech: { live: null, audio_missing: false } });
      return;
    }
    if (!canSpeak) {
      setError(t(lang, 'micUnsupported'));
      return;
    }
    finalsRef.current = [];
    interimRef.current = '';
    captureFailed.current = false;
    liveFailed.current = false;
    editedRef.current = false;
    setLive({ final: '', interim: '' });
    setSeconds(0);
    setWhisper('idle');
    try {
      if (speak.keep_audio) {
        recRef.current = await startRecording(speak.max_seconds, (s) => {
          setSeconds(s);
        });
      }
      recordingRef.current = true;
      startRecognition();
      setPhase('recording');
      const started = performance.now();
      if (!speak.keep_audio) {
        const tick = setInterval(() => {
          if (!recordingRef.current) return clearInterval(tick);
          setSeconds((performance.now() - started) / 1000);
        }, 250);
      }
      stopTimer.current = setTimeout(() => void finish(), speak.max_seconds * 1000 + 200);
      track(ctx.slug, ctx.responseId, { event: 'voice_start', question_key: q.key });
    } catch (e) {
      recordingRef.current = false;
      setPhase(hadAnswer ? 'review' : 'idle');
      setError((e as Error)?.name === 'NotAllowedError' ? t(lang, 'micDenied') : t(lang, 'micUnsupported'));
    }
  }

  async function finish() {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    if (stopTimer.current) clearTimeout(stopTimer.current);
    try {
      recogRef.current?.stop();
    } catch {
      /* ignore */
    }
    let rec: Recording | null = null;
    try {
      rec = recRef.current ? await recRef.current.stop() : null;
    } catch {
      rec = null;
    }
    recRef.current = null;
    // give the recogniser a moment to deliver its last final result
    await new Promise((r) => setTimeout(r, liveOn ? 350 : 0));
    // finalised words plus any words still marked interim when the respondent stopped
    const fullLive = [joinTranscript(finalsRef.current, '').final, interimRef.current.trim()].join(' ').trim().slice(0, maxChars);
    const missing = speak.keep_audio && (captureFailed.current || !rec || isNearSilent(rec.blob.size, rec.seconds));
    setPhase('review');
    setLive({ final: fullLive, interim: '' });

    if (missing && !fullLive) {
      setAudio('none');
      setError(t(lang, 'tooShort'));
      if (!hadAnswer) setPhase('idle');
      return;
    }
    emit({ text: fullLive, voice: false, speech: { live: fullLive || null, audio_missing: !!missing } });
    setAudio(missing ? 'missing' : speak.keep_audio ? 'uploading' : 'none');
    if (missing || !speak.keep_audio || !rec) {
      track(ctx.slug, ctx.responseId, { event: 'voice_sent', question_key: q.key });
      return;
    }
    lastRecording.current = rec;
    await upload(rec, fullLive);
  }

  async function upload(rec: Recording, liveText: string) {
    setAudio('uploading');
    try {
      const up = await voiceUploadUrl({
        property_slug: ctx.slug,
        response_id: ctx.responseId,
        form_version_id: ctx.formVersionId,
        question_key: q.key,
        mime: rec.mime,
        bytes: rec.blob.size,
        duration_seconds: Math.max(0.5, Math.round(rec.seconds * 10) / 10),
      });
      await uploadAudio(up.signed_url, rec.blob, rec.mime);
    } catch (e) {
      const err = e as ApiError;
      setAudio('failed');
      // the live text (if any) is still the answer
      setError(err.status === 409 || err.status === 413 || err.status === 415 ? err.message : liveText ? t(lang, 'uploadFailedKeepText') : t(lang, 'uploadFailed'));
      return;
    }
    setAudio('uploaded');
    emit({ voice: true });
    onUploaded(true);
    lastRecording.current = null;
    track(ctx.slug, ctx.responseId, { event: 'voice_sent', question_key: q.key });

    setWhisper('working');
    try {
      const res = await transcribeNow(ctx.responseId, q.key);
      if ('pending' in res) {
        setWhisper('pending');
        return;
      }
      const w = res.text.slice(0, maxChars);
      onUploaded(false);
      setWhisper('done');
      const current = (valueRef.current?.text ?? '').trim();
      if (!current && !editedRef.current) emit({ text: w }); // nothing live: Whisper fills the box
      else if (shouldOfferClearerVersion(liveText, w, editedRef.current)) setOffer(w);
    } catch {
      setWhisper('pending');
    }
  }

  const words = (
    <div className="min-h-24 rounded-xl border border-line bg-surface p-4 text-lg leading-relaxed" aria-live="polite" data-testid="live-box">
      <span className="text-ink" data-testid="live-final">{live.final}</span>{' '}
      <span className="text-muted" data-testid="live-interim">{live.interim}</span>
      {!live.final && !live.interim && <span className="text-muted">{liveOn ? t(lang, 'listening') : t(lang, 'recordingNoLive')}</span>}
    </div>
  );

  return (
    <div className="space-y-3">
      {phase !== 'recording' && liveOn && !ctx.preview && (
        <div className="flex items-center gap-2 text-sm text-muted">
          <span>{t(lang, 'speakingIn')}</span>
          {(['hi-IN', 'en-IN'] as const).map((l) => (
            <button key={l} type="button" onClick={() => setSpeechLang(l)} aria-pressed={speechLang === l}
              className={`rounded-full border px-3 py-1 ${speechLang === l ? 'border-primary bg-primary-soft text-ink' : 'border-line text-muted'}`}>
              {l === 'hi-IN' ? 'हिंदी' : 'English'}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-4">
        {phase === 'recording' ? (
          <button type="button" onClick={() => void finish()} className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-danger text-white" aria-label={t(lang, 'stopRecording')}>
            <span className="h-6 w-6 rounded-sm bg-white" />
          </button>
        ) : (
          <button type="button" onClick={() => void begin()} disabled={busy || !canSpeak || (speak.keep_audio && left <= 0 && !ctx.preview)}
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-primary text-primary-ink disabled:opacity-40" aria-label={t(lang, 'speak')}>
            <Icon name="mic" size={28} />
          </button>
        )}
        <p className="text-sm text-muted" aria-live="polite">
          {phase === 'recording'
            ? `${t(lang, 'recording')} · ${Math.floor(seconds)} / ${speak.max_seconds}s`
            : phase === 'review'
              ? speak.keep_audio && !ctx.preview ? `${t(lang, 'rerecord')} · ${t(lang, 'recordingsLeft', { n: Math.max(left, 0) })}` : t(lang, 'rerecord')
              : `${t(lang, 'speak')} · ${t(lang, 'maxLength', { s: speak.max_seconds })}`}
        </p>
      </div>

      {phase === 'recording' && words}

      {phase === 'review' && (
        <>
          {speak.allow_edit ? (
            <>
              <p className="text-sm text-muted">{t(lang, 'exactlyWhatWeReceive')}</p>
              <textarea
                data-testid="speak-text"
                className="r-input min-h-32 resize-y"
                value={text}
                maxLength={maxChars}
                aria-label={lang === 'hi' && q.label_hi ? q.label_hi : q.label_en}
                onChange={(e) => {
                  editedRef.current = true;
                  setOffer(null);
                  emit({ text: e.target.value });
                }}
              />
              <p className="text-right text-xs text-muted" aria-live="polite">{text.length} / {maxChars}</p>
            </>
          ) : (
            <div data-testid="speak-text" className="rounded-xl border border-line bg-surface p-4 text-lg text-ink">{text || '…'}</div>
          )}
          {whisper === 'working' && !text.trim() && <p className="text-sm text-muted">{t(lang, 'transcribing')}</p>}
          {whisper === 'pending' && !text.trim() && <p className="rounded-xl bg-primary-soft p-3 text-sm text-ink">{t(lang, 'pending')}</p>}
          {audio === 'missing' && <p className="text-sm text-muted">{t(lang, 'audioMissingKept')}</p>}
          {offer && (
            <div className="rounded-xl border border-line bg-primary-soft p-3 text-sm text-ink" data-testid="clearer-offer">
              <p>{t(lang, 'clearerVersion')}</p>
              <p className="mt-1 italic">“{offer}”</p>
              <div className="mt-2 flex gap-4">
                <button type="button" className="r-link" onClick={() => { emit({ text: offer }); setOffer(null); }}>{t(lang, 'useIt')}</button>
                <button type="button" className="r-link" onClick={() => setOffer(null)}>{t(lang, 'keepMine')}</button>
              </div>
            </div>
          )}
        </>
      )}

      {error && (
        <div role="alert" className="rounded-xl border border-line bg-surface p-3 text-sm text-danger">
          {error}
          {audio === 'failed' && lastRecording.current && (
            <button type="button" className="ml-2 font-semibold underline" onClick={() => lastRecording.current && void upload(lastRecording.current, live.final)}>
              {t(lang, 'retry')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
