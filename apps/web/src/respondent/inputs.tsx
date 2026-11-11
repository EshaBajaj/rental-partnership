import { useState } from 'react';
import type { CompiledQuestion, ContactValue, RawAnswer } from '@shared/types.ts';
import { OTHER_VALUE } from '@shared/types.ts';
import { type Lang, pick, t } from './i18n.ts';
import { amountWords, formatInr, parseAmount } from './flow.ts';
import { VoiceAnswer, type VoiceCtx } from './VoiceAnswer.tsx';

interface Props {
  q: CompiledQuestion;
  lang: Lang;
  value: RawAnswer | undefined;
  onChange: (a: RawAnswer) => void;
  /** single-choice tap → advance */
  onPicked: () => void;
  ctx: VoiceCtx;
  uploads: number;
  onUploaded: (pending: boolean) => void;
  onBusy: (busy: boolean) => void;
}

const optionClass = (selected: boolean) =>
  `w-full rounded-2xl border-2 px-4 py-4 text-left text-lg transition ${
    selected ? 'border-brand-700 bg-brand-50 font-semibold text-brand-800' : 'border-stone-200 bg-white hover:border-stone-300 active:bg-stone-50'
  }`;

export function QuestionInput(p: Props) {
  const { q, lang, value, onChange } = p;
  const ph = q.placeholder ?? '';
  switch (q.type) {
    case 'single':
    case 'yes_no':
      return <SingleChoice {...p} />;
    case 'dropdown':
      return <Dropdown {...p} />;
    case 'multi':
      return <MultiChoice {...p} />;
    case 'short_text':
    case 'long_text':
      if (q.allow_voice) {
        return <VoiceAnswer {...p} placeholder={ph} multiline={q.type === 'long_text'} voiceFirst={false} />;
      }
      return q.type === 'long_text' ? (
        <textarea
          className="input min-h-32"
          value={typeof value?.value === 'string' ? value.value : ''}
          maxLength={q.validation.maxLength ?? 2000}
          placeholder={ph}
          aria-label={pick(lang, q.label_en, q.label_hi)}
          onChange={(e) => onChange({ value: e.target.value })}
        />
      ) : (
        <input
          className="input"
          value={typeof value?.value === 'string' ? value.value : ''}
          maxLength={q.validation.maxLength ?? 200}
          placeholder={ph}
          aria-label={pick(lang, q.label_en, q.label_hi)}
          onChange={(e) => onChange({ value: e.target.value })}
        />
      );
    case 'voice':
      return <VoiceAnswer {...p} placeholder={ph} multiline voiceFirst />;
    case 'number':
    case 'currency':
      return <Amount {...p} />;
    case 'date':
      return (
        <input
          type="date"
          className="input text-lg"
          value={typeof value?.value === 'string' ? value.value : ''}
          min={typeof q.validation.min === 'string' ? q.validation.min : undefined}
          max={typeof q.validation.max === 'string' ? q.validation.max : undefined}
          aria-label={pick(lang, q.label_en, q.label_hi)}
          onChange={(e) => onChange({ value: e.target.value || null })}
        />
      );
    case 'contact':
      return <Contact {...p} />;
  }
}

function SingleChoice({ q, lang, value, onChange, onPicked }: Props) {
  const sel = typeof value?.value === 'string' ? value.value : null;
  const otherSelected = sel === OTHER_VALUE;
  return (
    <div className="space-y-3" role="radiogroup" aria-label={pick(lang, q.label_en, q.label_hi)}>
      {q.options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={sel === o.value}
          className={optionClass(sel === o.value)}
          onClick={() => {
            onChange({ value: o.value });
            onPicked();
          }}
        >
          {pick(lang, o.label_en, o.label_hi)}
        </button>
      ))}
      {q.allow_other && (
        <>
          <button type="button" role="radio" aria-checked={otherSelected} className={optionClass(otherSelected)} onClick={() => onChange({ value: OTHER_VALUE, other_text: value?.other_text ?? '' })}>
            {t(lang, 'other')}
          </button>
          {otherSelected && (
            <input
              autoFocus
              className="input"
              maxLength={200}
              placeholder={t(lang, 'otherPlaceholder')}
              value={value?.other_text ?? ''}
              onChange={(e) => onChange({ value: OTHER_VALUE, other_text: e.target.value })}
            />
          )}
        </>
      )}
    </div>
  );
}

function Dropdown({ q, lang, value, onChange }: Props) {
  const sel = typeof value?.value === 'string' ? value.value : '';
  return (
    <div className="space-y-3">
      <select className="input text-lg" value={sel} aria-label={pick(lang, q.label_en, q.label_hi)} onChange={(e) => onChange({ value: e.target.value || null, other_text: value?.other_text })}>
        <option value="">{t(lang, 'choose')}</option>
        {q.options.map((o) => (
          <option key={o.value} value={o.value}>
            {pick(lang, o.label_en, o.label_hi)}
          </option>
        ))}
        {q.allow_other && <option value={OTHER_VALUE}>{t(lang, 'other')}</option>}
      </select>
      {sel === OTHER_VALUE && (
        <input className="input" maxLength={200} placeholder={t(lang, 'otherPlaceholder')} value={value?.other_text ?? ''} onChange={(e) => onChange({ value: OTHER_VALUE, other_text: e.target.value })} />
      )}
    </div>
  );
}

function MultiChoice({ q, lang, value, onChange }: Props) {
  const sel = Array.isArray(value?.value) ? (value!.value as string[]) : [];
  const toggle = (v: string) => {
    const next = sel.includes(v) ? sel.filter((x) => x !== v) : [...sel, v];
    if (q.validation.maxPicks && next.length > q.validation.maxPicks) return;
    onChange({ value: next, other_text: value?.other_text });
  };
  const opts = [...q.options.map((o) => ({ value: o.value, label: pick(lang, o.label_en, o.label_hi) })), ...(q.allow_other ? [{ value: OTHER_VALUE, label: t(lang, 'other') }] : [])];
  return (
    <div className="space-y-3">
      <p className="text-sm text-stone-500">{t(lang, 'pickAll')}</p>
      {opts.map((o) => (
        <button key={o.value} type="button" role="checkbox" aria-checked={sel.includes(o.value)} className={optionClass(sel.includes(o.value))} onClick={() => toggle(o.value)}>
          <span className="mr-2 inline-block w-5">{sel.includes(o.value) ? '☑' : '☐'}</span>
          {o.label}
        </button>
      ))}
      {sel.includes(OTHER_VALUE) && (
        <input className="input" maxLength={200} placeholder={t(lang, 'otherPlaceholder')} value={value?.other_text ?? ''} onChange={(e) => onChange({ value: sel, other_text: e.target.value })} />
      )}
    </div>
  );
}

function Amount({ q, lang, value, onChange }: Props) {
  const num = typeof value?.value === 'number' ? value.value : null;
  const [text, setText] = useState(num === null ? '' : String(num));
  const currency = q.type === 'currency';
  return (
    <div className="space-y-2">
      <div className="relative">
        {currency && <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-xl text-stone-500">₹</span>}
        <input
          className={`input text-2xl ${currency ? 'pl-10' : ''}`}
          inputMode="decimal"
          autoComplete="off"
          placeholder={q.placeholder ?? (currency ? '50000' : '')}
          value={text}
          aria-label={pick(lang, q.label_en, q.label_hi)}
          onChange={(e) => {
            const s = e.target.value.replace(/[^\d.,]/g, '');
            setText(s);
            onChange({ value: s === '' ? null : parseAmount(s) });
          }}
        />
      </div>
      {currency && (
        <p className="min-h-5 text-sm text-stone-600" aria-live="polite">
          {num !== null ? `${formatInr(num)} ${amountWords(num, lang) ? `(${amountWords(num, lang)})` : ''}` : t(lang, 'amountHint')}
        </p>
      )}
    </div>
  );
}

function Contact({ lang, value, onChange }: Props) {
  const c: ContactValue =
    value?.value && typeof value.value === 'object' && !Array.isArray(value.value)
      ? (value.value as ContactValue)
      : { name: '', phone: '', whatsapp_ok: true, consent: false };
  const set = (patch: Partial<ContactValue>) => onChange({ value: { ...c, ...patch } });
  return (
    <div className="space-y-4">
      <div>
        <label className="label" htmlFor="c-name">{t(lang, 'name')}</label>
        <input id="c-name" className="input text-lg" autoComplete="name" maxLength={80} value={c.name} onChange={(e) => set({ name: e.target.value })} />
      </div>
      <div>
        <label className="label" htmlFor="c-phone">{t(lang, 'phone')}</label>
        <div className="flex">
          <span className="flex items-center rounded-l-xl border border-r-0 border-stone-300 bg-stone-100 px-3 text-stone-600">+91</span>
          <input
            id="c-phone"
            className="input rounded-l-none text-lg"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            maxLength={20}
            placeholder="98765 43210"
            value={c.phone}
            onChange={(e) => set({ phone: e.target.value })}
          />
        </div>
      </div>
      <label className="flex items-center gap-3 rounded-xl bg-white p-3">
        <input type="checkbox" className="h-6 w-6 accent-brand-700" checked={c.whatsapp_ok} onChange={(e) => set({ whatsapp_ok: e.target.checked })} />
        <span>{t(lang, 'whatsapp')}</span>
      </label>
      <label className="flex items-center gap-3 rounded-xl bg-white p-3">
        <input type="checkbox" className="h-6 w-6 accent-brand-700" checked={c.consent} onChange={(e) => set({ consent: e.target.checked })} />
        <span>{t(lang, 'consent')}</span>
      </label>
    </div>
  );
}
