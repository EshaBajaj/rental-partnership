import { useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ERROR_TEXT, upgradeRawAnswer, validateOne } from '@shared/answers.ts';
import type { CompiledQuestion, ContactValue, RawAnswer } from '@shared/types.ts';
import { ApiError, getForm, type PublicProperty, submit } from './api.ts';
import { BrandMark, DoneScreen, LangToggle, PrivacyPage, TrustFooter, Welcome } from './Trust.tsx';
import { DEMO_MODE, FUNCTIONS_URL } from '../lib/env.ts';
import { type Lang, t } from './i18n.ts';
import { Questionnaire } from './Questionnaire.tsx';
import { QuestionInput } from './inputs.tsx';
import {
  clearDone,
  clearOutbox,
  clearProgress,
  type Done,
  loadDone,
  loadOutbox,
  loadProgress,
  type Progress,
  saveDone,
  saveOutbox,
  uuid,
} from './storage.ts';

function useOutbox(slug: string, onSent: (d: Done) => void) {
  const [queued, setQueued] = useState(() => !!loadOutbox(slug));
  const [sending, setSending] = useState(false);
  const flush = useCallback(async () => {
    const payload = loadOutbox(slug);
    if (!payload) return setQueued(false);
    setSending(true);
    try {
      await submit(payload);
      clearOutbox(slug);
      clearProgress(slug);
      const c = Object.values(payload.answers).find((a) => a.value && typeof a.value === 'object' && !Array.isArray(a.value))?.value as ContactValue | undefined;
      const d: Done = { id: payload.id, name: c?.name ?? '', whatsapp: !!c?.whatsapp_ok, waitlist: !!payload.waitlist, at: Date.now() };
      saveDone(slug, d);
      setQueued(false);
      onSent(d);
    } catch (e) {
      const err = e as ApiError;
      // 4xx other than rate limiting will never succeed: surface it instead of retrying forever.
      if (err.status >= 400 && err.status < 500 && err.status !== 429 && err.status !== 408) {
        clearOutbox(slug);
        setQueued(false);
      }
    } finally {
      setSending(false);
    }
  }, [slug, onSent]);

  useEffect(() => {
    if (queued) void flush();
    const on = () => void flush();
    window.addEventListener('online', on);
    const timer = setInterval(() => loadOutbox(slug) && navigator.onLine && void flush(), 30_000);
    return () => {
      window.removeEventListener('online', on);
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);
  return { queued, sending, flush, markQueued: () => setQueued(true) };
}

function useForm(slug: string) {
  return useQuery({ queryKey: ['form', slug], queryFn: () => getForm(slug), retry: (n, e) => (e as ApiError).status !== 404 && n < 3 });
}

export function RespondentApp() {
  const { slug = '' } = useParams();
  const [params] = useSearchParams();
  const source = (params.get('src') ?? 'qr').slice(0, 60);
  const qc = useQueryClient();
  const [done, setDone] = useState<Done | null>(() => loadDone(slug));
  const [langOverride, setLangOverride] = useState<Lang | null>(() => loadProgress(slug)?.lang ?? loadLang());
  const [started, setStarted] = useState(() => !!loadProgress(slug));
  const outbox = useOutbox(slug, setDone);
  const form = useForm(slug);
  const lang: Lang = langOverride ?? form.data?.property.default_lang ?? 'en';
  const setLang = (l: Lang) => {
    setLangOverride(l);
    saveLang(l);
  };

  useEffect(() => {
    document.documentElement.lang = lang;
    if (form.data) document.title = `${form.data.property.name} · ${form.data.property.brand_name}`;
  }, [lang, form.data]);

  let body: React.ReactNode;
  if (done && form.data) body = <DoneScreen property={form.data.property} lang={lang} name={done.name} waitlist={done.waitlist} onAgain={() => { clearDone(slug); setDone(null); setStarted(false); }} />;
  else if (outbox.queued) {
    body = (
      <Shell>
        <div className="r-card space-y-4 p-6 text-center">
          <p className="text-lg text-ink">{t(lang, 'offlineSaved')}</p>
          <button className="r-btn-primary w-full" disabled={outbox.sending} onClick={() => void outbox.flush()}>
            {outbox.sending ? t(lang, 'sending') : t(lang, 'sendNow')}
          </button>
        </div>
      </Shell>
    );
  } else if (form.isLoading) body = <Shell><p className="text-center text-muted">{t(lang, 'loading')}</p></Shell>;
  else if (form.isError || !form.data) {
    const notFound = (form.error as ApiError | null)?.status === 404;
    body = (
      <Shell>
        <div className="r-card space-y-4 p-6 text-center">
          <p className="text-ink">{notFound ? t(lang, 'notFound') : t(lang, 'loadError')}</p>
          {(import.meta.env.DEV || location.hostname === 'localhost') && <SetupHint error={form.error as ApiError | null} />}
          {!notFound && <button className="r-btn-primary w-full" onClick={() => void form.refetch()}>{t(lang, 'retry')}</button>}
        </div>
      </Shell>
    );
  } else if (done) {
    body = <Shell><p className="text-center text-muted">{t(lang, 'loading')}</p></Shell>;
  } else {
    const data = form.data;
    if (data.status === 'closed' || !data.form) {
      body = <Closed slug={slug} lang={lang} property={data.property} message={data.closed_message ?? ''} source={source} onLang={setLang} onDone={setDone} onQueued={outbox.markQueued} />;
    } else if (!started) {
      body = <Welcome property={data.property} lang={lang} onLang={setLang} onStart={() => setStarted(true)} />;
    } else {
      const cfg = data.form.config;
      const saved = loadProgress(slug);
      const resumed = !!saved && Object.keys(saved.answers).length > 0;
      // answers saved by an older app version are upgraded to the current shape
      const savedAnswers = saved
        ? Object.fromEntries(
            Object.entries(saved.answers)
              .map(([k]) => [k, cfg.questions.find((q) => q.key === k)] as const)
              .filter(([, q]) => !!q)
              .map(([k, q]) => [k, upgradeRawAnswer(q!, saved.answers[k])!]),
          )
        : {};
      const initial: Progress = saved
        ? { ...saved, form_version_id: data.form.id, answers: savedAnswers }
        : { v: 1, slug, response_id: uuid(), form_version_id: data.form.id, answers: {}, current: null, started_at: Date.now(), lang, voice: {} };
      body = (
        <Questionnaire
          key={data.form.id}
          slug={slug}
          form={data.form}
          initial={initial}
          resumed={resumed}
          source={source}
          property={data.property}
          onLang={setLang}
          onDone={() => setDone(loadDone(slug))}
          onQueued={outbox.markQueued}
          onFormChanged={() => void qc.invalidateQueries({ queryKey: ['form', slug] })}
        />
      );
    }
  }

  return (
    <div className="respondent min-h-dvh bg-bg text-ink">
      {DEMO_MODE && (
        <div className="bg-primary-soft px-4 py-2 text-center text-sm text-ink">
          Demo mode — not connected to Supabase. Answers stay on this device. Set VITE_SUPABASE_URL to go live.
        </div>
      )}
      {body}
    </div>
  );
}

/** /p/:slug/privacy */
export function PrivacyRoute() {
  const { slug = '' } = useParams();
  const form = useForm(slug);
  const [langOverride, setLangOverride] = useState<Lang | null>(() => loadLang());
  const lang: Lang = langOverride ?? form.data?.property.default_lang ?? 'en';
  return (
    <div className="respondent min-h-dvh bg-bg text-ink">
      {form.data ? (
        <PrivacyPage property={form.data.property} lang={lang} onLang={(l) => { setLangOverride(l); saveLang(l); }} />
      ) : (
        <Shell><p className="text-center text-muted">{form.isError ? t(lang, 'loadError') : t(lang, 'loading')}</p></Shell>
      )}
    </div>
  );
}

const LANG_KEY = 'sls.lang';
function loadLang(): Lang | null {
  try {
    const l = localStorage.getItem(LANG_KEY);
    return l === 'en' || l === 'hi' ? l : null;
  } catch {
    return null;
  }
}
function saveLang(l: Lang) {
  try {
    localStorage.setItem(LANG_KEY, l);
  } catch {
    /* ignore */
  }
}

/** Shown only on localhost / dev builds: what exactly failed and how to fix it. */
function SetupHint({ error }: { error: ApiError | null }) {
  const why =
    !error ? '' :
    error.status === 0 ? 'The server could not be reached. Is VITE_SUPABASE_URL the full https://<ref>.supabase.co address, and are the Edge Functions deployed (docs/DEPLOY.md step 4)?' :
    error.status === 404 && error.code === 'not_found' ? 'The server works, but no property with this slug exists. Run supabase/seed.sql or open /f/<your-slug>.' :
    error.status === 404 ? 'The "form" Edge Function is not deployed on this project (docs/DEPLOY.md step 4).' :
    error.status === 503 ? 'The form has never been published. Sign in at /admin → Form → Publish.' :
    error.status === 401 || error.status === 403 ? 'The function rejected the request. Deploy the functions with --no-verify-jwt (docs/DEPLOY.md).' :
    'See the browser console for details.';
  return (
    <div className="rounded-xl bg-stone-100 p-3 text-left text-xs text-stone-700">
      <p className="font-semibold">Setup help (only shown on localhost)</p>
      <p className="mt-1">Server: <code className="break-all">{FUNCTIONS_URL}</code></p>
      {error && <p className="mt-1 break-all">Error: {error.status ? `HTTP ${error.status} ${error.code}` : error.message}</p>}
      <p className="mt-1">{why}</p>
      <p className="mt-1">Want to try the form without a server? Remove VITE_SUPABASE_URL from apps/web/.env.local (or set VITE_DEMO=1) and restart npm run dev.</p>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-4 py-8">{children}</div>;
}

const WAITLIST_Q: CompiledQuestion = {
  key: 'contact', kind: 'contact', label_en: 'Contact', label_hi: null, help_en: null, help_hi: null,
  required: true, show_if: null, validation: {}, input_modes: null, options: [],
};

function Closed(props: { slug: string; lang: Lang; property: PublicProperty; message: string; source: string; onLang: (l: Lang) => void; onDone: (d: Done) => void; onQueued: () => void }) {
  const { slug, lang, property, message, source } = props;
  const [open, setOpen] = useState(false);
  const [answer, setAnswer] = useState<RawAnswer | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [id] = useState(uuid);
  const [started] = useState(Date.now());

  async function join() {
    const r = validateOne(WAITLIST_Q, answer);
    if (!r.ok) return setError(ERROR_TEXT[r.code][lang]);
    setSending(true);
    const payload = { id, property_slug: slug, form_version_id: null, waitlist: true, answers: { contact: answer! }, lang, source, duration_seconds: Math.round((Date.now() - started) / 1000), website: '' };
    try {
      await submit(payload);
      const c = answer!.value as ContactValue;
      const d: Done = { id, name: c.name, whatsapp: c.whatsapp_ok, waitlist: true, at: Date.now() };
      saveDone(slug, d);
      props.onDone(d);
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 0 || err.status >= 500) {
        saveOutbox(slug, payload);
        props.onQueued();
      } else setError(err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col px-4 pb-6 pt-4">
      <header className="mb-6 flex items-center justify-between gap-2">
        <BrandMark property={property} />
        <LangToggle lang={lang} onLang={props.onLang} />
      </header>
      <div className="space-y-4">
        <p className="text-sm font-medium text-muted">{property.name}</p>
        <h1 className="text-2xl font-semibold text-ink">{t(lang, 'closedTitle')}</h1>
        <p className="whitespace-pre-line text-ink">{message}</p>
        {!open ? (
          <button className="r-btn-primary w-full" onClick={() => setOpen(true)}>
            {t(lang, 'waitlistCta')}
          </button>
        ) : (
          <>
            <QuestionInput
              q={WAITLIST_Q}
              lang={lang}
              value={answer}
              onChange={(a) => { setError(null); setAnswer(a); }}
              onPicked={() => undefined}
              ctx={{ slug, responseId: id, formVersionId: '' }}
              uploads={0}
              onUploaded={() => undefined}
              onBusy={() => undefined}
            />
            {error && <p role="alert" className="rounded-xl border border-line bg-surface p-3 text-danger">{error}</p>}
            <button className="r-btn-primary w-full" disabled={sending} onClick={() => void join()}>
              {sending ? t(lang, 'sending') : t(lang, 'send')}
            </button>
          </>
        )}
      </div>
      <div className="flex-1" />
      <TrustFooter property={property} lang={lang} />
    </div>
  );
}
