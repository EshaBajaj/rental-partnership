import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormConfig, RawAnswer } from '@shared/types.ts';
import { ERROR_TEXT, validateOne } from '@shared/answers.ts';
import { type Lang, pick, t } from './i18n.ts';
import { answersToSubmit, nextKey, prevKey, resolveCurrent, totalScreens, visibleQuestions } from './flow.ts';
import { QuestionInput } from './inputs.tsx';
import { ApiError, flushTrack, type PublicProperty, submit, type SubmitPayload, track } from './api.ts';
import { BrandMark, LangToggle, TrustFooter } from './Trust.tsx';
import { clearOutbox, clearProgress, type Progress, saveDone, saveOutbox, saveProgress } from './storage.ts';
import { Icon } from '../lib/icons.tsx';

interface Props {
  slug: string;
  form: { id: string; version: number; config: FormConfig };
  initial: Progress;
  resumed: boolean;
  source: string;
  property: PublicProperty;
  onLang: (l: Lang) => void;
  onDone: () => void;
  onQueued: () => void;
  onFormChanged: () => void;
}

export function Questionnaire({ slug, form, initial, resumed, source, property, onLang, onDone, onQueued, onFormChanged }: Props) {
  const config = form.config;
  const [p, setP] = useState<Progress>(() => ({ ...initial, current: resolveCurrent(config, initial.answers, initial.current) }));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showResumed, setShowResumed] = useState(resumed);
  const honeypot = useRef<HTMLInputElement>(null);
  const shownAt = useRef(Date.now());
  const lang = p.lang;

  useEffect(() => saveProgress(p), [p]);
  useEffect(() => {
    track(slug, p.response_id, { event: 'view' });
    if (!resumed) track(slug, p.response_id, { event: 'start' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = useMemo(() => visibleQuestions(config, p.answers), [config, p.answers]);
  const current = p.current ?? visible[0].key;
  const q = config.questions.find((x) => x.key === current) ?? visible[0];
  const index = Math.max(visible.findIndex((x) => x.key === q.key), 0);
  const isLast = nextKey(config, p.answers, q.key) === null;

  const setAnswer = useCallback(
    (a: RawAnswer) => {
      setError(null);
      setP((s) => ({ ...s, answers: { ...s.answers, [q.key]: a } }));
    },
    [q.key],
  );
  const setUploaded = useCallback(
    (pending: boolean) =>
      setP((s) => {
        const prev = s.voice[q.key];
        return { ...s, voice: { ...s.voice, [q.key]: { uploads: pending ? (prev?.uploads ?? 0) + 1 : (prev?.uploads ?? 1), pending } } };
      }),
    [q.key],
  );

  function go(key: string) {
    track(slug, p.response_id, { event: 'answer', question_key: q.key, ms: Date.now() - shownAt.current });
    shownAt.current = Date.now();
    setError(null);
    setP((s) => ({ ...s, current: key }));
    window.scrollTo({ top: 0 });
  }

  function validateCurrent(): boolean {
    const r = validateOne(q, p.answers[q.key]);
    if (!r.ok) {
      setError(ERROR_TEXT[r.code][lang]);
      return false;
    }
    return true;
  }

  function next() {
    if (busy || submitting) return;
    if (!validateCurrent()) return;
    const n = nextKey(config, p.answers, q.key);
    if (n) go(n);
    else void send();
  }

  // latest `next` for delayed auto-advance (runs after the answer state has re-rendered)
  const nextRef = useRef(next);
  nextRef.current = next;

  function back() {
    const b = prevKey(config, p.answers, q.key);
    if (b) {
      track(slug, p.response_id, { event: 'back', question_key: q.key });
      setError(null);
      setP((s) => ({ ...s, current: b }));
    }
  }

  async function send() {
    setSubmitting(true);
    setError(null);
    track(slug, p.response_id, { event: 'submit_attempt' });
    const payload: SubmitPayload = {
      id: p.response_id,
      property_slug: slug,
      form_version_id: form.id,
      answers: answersToSubmit(config, p.answers),
      lang,
      source,
      duration_seconds: Math.round((Date.now() - p.started_at) / 1000),
      website: honeypot.current?.value ?? '',
    };
    const contact = payload.answers[config.questions.find((x) => x.kind === 'contact')?.key ?? 'contact']?.value as
      | { name: string; whatsapp_ok: boolean }
      | undefined;
    try {
      await submit(payload);
      track(slug, p.response_id, { event: 'submit_ok' });
      flushTrack();
      clearOutbox(slug);
      clearProgress(slug);
      saveDone(slug, { id: p.response_id, name: contact?.name ?? '', whatsapp: !!contact?.whatsapp_ok, waitlist: false, at: Date.now() });
      onDone();
    } catch (e) {
      const err = e as ApiError;
      track(slug, p.response_id, { event: 'submit_error' });
      if (err.status === 422 && Array.isArray(err.details) && err.details.length) {
        const first = err.details[0] as { key: string; message: string };
        if (visible.some((x) => x.key === first.key)) setP((s) => ({ ...s, current: first.key }));
        setError(first.message);
      } else if (err.status === 409 && err.code === 'form_changed') {
        setError(t(lang, 'formChanged'));
        onFormChanged();
      } else if (err.status === 429) {
        saveOutbox(slug, payload);
        setError(t(lang, 'tooMany'));
      } else if (err.status === 0 || err.status >= 500) {
        // Keep it safe on the phone and retry automatically when back online.
        saveOutbox(slug, payload);
        onQueued();
      } else {
        setError(err.message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  const label = pick(lang, q.label_en, q.label_hi);
  const help = pick(lang, q.help_en ?? '', q.help_hi);
  const total = Math.max(totalScreens(config, p.answers), index + 1);
  const pct = Math.round(((index + 1) / total) * 100);

  const setLang = (l: Lang) => {
    setP((s) => ({ ...s, lang: l }));
    onLang(l);
  };
  const answered = !!p.answers[q.key] && Object.keys(p.answers[q.key]).length > 0;

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col px-4 pb-4 pt-4">
      <header className="mb-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <BrandMark property={property} />
          <LangToggle lang={lang} onLang={setLang} />
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-1.5 text-xs text-muted">
          {t(lang, 'step', { n: index + 1, t: total })}
          {index === 0 ? ` · ${t(lang, 'about2min')}` : ''}
        </p>
      </header>

      {showResumed && (
        <div className="mb-4 flex items-center justify-between rounded-xl bg-primary-soft p-3 text-sm text-ink">
          <span>{t(lang, 'resumed')}</span>
          <button type="button" className="font-semibold underline" onClick={() => setShowResumed(false)}>
            OK
          </button>
        </div>
      )}

      <main className="flex-1">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            next();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.target instanceof HTMLInputElement && e.target.type !== 'checkbox') {
              e.preventDefault();
              next();
            }
          }}
          noValidate
        >
          <h1 className="text-2xl font-semibold leading-snug text-ink" id="q-label">
            {label}
          </h1>
          {help && <p className="mt-2 text-muted">{help}</p>}
          {!q.required && q.kind !== 'contact' && <p className="mt-1 text-sm text-muted">{t(lang, 'optional')}</p>}
          <div className="mt-6">
            <QuestionInput
              key={q.key}
              q={q}
              lang={lang}
              value={p.answers[q.key]}
              onChange={setAnswer}
              onPicked={() => {
                // a single-select option was tapped and there is nothing else to answer here
                setTimeout(() => nextRef.current(), 200);
              }}
              ctx={{ slug, responseId: p.response_id, formVersionId: form.id, speechLang: property.default_speech_lang }}
              uploads={p.voice[q.key]?.uploads ?? 0}
              onUploaded={setUploaded}
              onBusy={setBusy}
            />
          </div>
          {/* honeypot: invisible to people, tempting to bots */}
          <input ref={honeypot} name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 opacity-0" />
          {error && (
            <p role="alert" className="mt-4 rounded-xl border border-line bg-surface p-3 text-danger">
              {error}
            </p>
          )}
        </form>
      </main>

      <footer className="sticky bottom-0 mt-6 bg-bg pb-[env(safe-area-inset-bottom)] pt-3">
        {/* soft fade so options scrolling under the bar don't look cut off */}
        <div className="pointer-events-none absolute inset-x-0 -top-6 h-6 bg-gradient-to-t from-bg to-transparent" aria-hidden="true" />
        <div className="flex gap-3">
          {index > 0 && (
            <button type="button" className="r-btn-secondary w-28 shrink-0 px-3" onClick={back} disabled={submitting || busy}>
              <Icon name="back" size={20} />
              {t(lang, 'back')}
            </button>
          )}
          <button type="button" className="r-btn-primary min-w-0 flex-1" onClick={next} disabled={submitting || busy}>
            {submitting ? t(lang, 'sending') : isLast ? t(lang, 'send') : !q.required && !answered ? t(lang, 'skip') : t(lang, 'next')}
            {!submitting && <Icon name={isLast ? 'tick' : 'forward'} size={20} />}
          </button>
        </div>
        <TrustFooter property={property} lang={lang} />
      </footer>
    </div>
  );
}
