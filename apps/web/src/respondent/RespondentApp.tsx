import { useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ERROR_TEXT, validateOne } from '@shared/answers.ts';
import type { CompiledQuestion, ContactValue, RawAnswer } from '@shared/types.ts';
import { ApiError, getForm, submit } from './api.ts';
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

export function RespondentApp() {
  const { slug = '' } = useParams();
  const [params] = useSearchParams();
  const source = (params.get('src') ?? 'qr').slice(0, 60);
  const qc = useQueryClient();
  const [done, setDone] = useState<Done | null>(() => loadDone(slug));
  const [langOverride, setLangOverride] = useState<Lang | null>(() => loadProgress(slug)?.lang ?? null);
  const outbox = useOutbox(slug, setDone);
  const form = useQuery({ queryKey: ['form', slug], queryFn: () => getForm(slug), retry: (n, e) => (e as ApiError).status !== 404 && n < 3 });
  const lang: Lang = langOverride ?? form.data?.property.default_lang ?? 'en';

  useEffect(() => {
    document.documentElement.lang = lang;
    if (form.data) document.title = form.data.property.name;
  }, [lang, form.data]);

  if (done) return <ThankYou lang={lang} done={done} onAgain={() => { clearDone(slug); setDone(null); }} />;

  if (outbox.queued) {
    return (
      <Shell>
        <div className="card space-y-4 p-6 text-center">
          <div className="text-4xl">📶</div>
          <p className="text-lg">{t(lang, 'offlineSaved')}</p>
          <button className="btn-primary w-full py-4 text-lg" disabled={outbox.sending} onClick={() => void outbox.flush()}>
            {outbox.sending ? t(lang, 'sending') : t(lang, 'sendNow')}
          </button>
        </div>
      </Shell>
    );
  }

  if (form.isLoading) return <Shell><p className="text-center text-stone-500">{t(lang, 'loading')}</p></Shell>;
  if (form.isError || !form.data) {
    const notFound = (form.error as ApiError | null)?.status === 404;
    return (
      <Shell>
        <div className="card space-y-4 p-6 text-center">
          <p>{notFound ? t(lang, 'notFound') : t(lang, 'loadError')}</p>
          {!notFound && <button className="btn-primary w-full" onClick={() => void form.refetch()}>{t(lang, 'retry')}</button>}
        </div>
      </Shell>
    );
  }

  const data = form.data;
  if (data.status === 'closed' || !data.form) {
    return <Closed slug={slug} lang={lang} name={data.property.name} message={data.closed_message ?? ''} source={source} onLang={setLangOverride} onDone={setDone} onQueued={outbox.markQueued} />;
  }

  const saved = loadProgress(slug);
  const resumed = !!saved && Object.keys(saved.answers).length > 0;
  const initial: Progress = saved
    ? {
        ...saved,
        form_version_id: data.form.id,
        answers: Object.fromEntries(Object.entries(saved.answers).filter(([k]) => data.form!.config.questions.some((q) => q.key === k))),
      }
    : { v: 1, slug, response_id: uuid(), form_version_id: data.form.id, answers: {}, current: null, started_at: Date.now(), lang, voice: {} };

  return (
    <Questionnaire
      key={data.form.id}
      slug={slug}
      form={data.form}
      initial={initial}
      resumed={resumed}
      source={source}
      propertyName={data.property.name}
      onLang={setLangOverride}
      onDone={() => setDone(loadDone(slug))}
      onQueued={outbox.markQueued}
      onFormChanged={() => void qc.invalidateQueries({ queryKey: ['form', slug] })}
    />
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-4 py-8">{children}</div>;
}

function ThankYou({ lang, done, onAgain }: { lang: Lang; done: Done; onAgain: () => void }) {
  return (
    <Shell>
      <div className="card space-y-4 p-8 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-brand-100 text-3xl text-brand-700">✓</div>
        <h1 className="text-2xl font-semibold">{t(lang, 'thanksTitle', { name: done.name.split(' ')[0] || '' }).replace(', !', '!')}</h1>
        <p className="text-lg text-stone-700">{done.waitlist ? t(lang, 'waitlistDone') : t(lang, 'thanksBody')}</p>
        {done.whatsapp && <p className="text-stone-600">{t(lang, 'thanksWhatsapp')}</p>}
        <button className="text-sm text-stone-400 underline" onClick={onAgain}>
          {t(lang, 'startOver')}
        </button>
      </div>
    </Shell>
  );
}

const WAITLIST_Q: CompiledQuestion = {
  key: 'contact', type: 'contact', label_en: 'Contact', label_hi: null, help_en: null, help_hi: null, placeholder: null,
  required: true, show_if: null, validation: {}, allow_other: false, allow_voice: false, options: [],
};

function Closed(props: { slug: string; lang: Lang; name: string; message: string; source: string; onLang: (l: Lang) => void; onDone: (d: Done) => void; onQueued: () => void }) {
  const { slug, lang, name, message, source } = props;
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
    <Shell>
      <div className="mb-3 flex justify-end">
        <button className="rounded-full border border-stone-300 px-3 py-1 text-sm" onClick={() => props.onLang(lang === 'en' ? 'hi' : 'en')}>
          {t(lang, 'language')}
        </button>
      </div>
      <div className="card space-y-4 p-6">
        <p className="text-sm font-medium text-stone-500">{name}</p>
        <h1 className="text-2xl font-semibold">{t(lang, 'closedTitle')}</h1>
        <p className="whitespace-pre-line text-stone-700">{message}</p>
        {!open ? (
          <button className="btn-primary w-full py-4 text-lg" onClick={() => setOpen(true)}>
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
            {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-800">{error}</p>}
            <button className="btn-primary w-full py-4 text-lg" disabled={sending} onClick={() => void join()}>
              {sending ? t(lang, 'sending') : t(lang, 'send')}
            </button>
          </>
        )}
      </div>
    </Shell>
  );
}
