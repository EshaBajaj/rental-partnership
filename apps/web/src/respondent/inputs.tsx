import { useState } from 'react';
import type { ChooseMode, CompiledQuestion, ContactValue, InputMode, RawAnswer, TypeMode } from '@shared/types.ts';
import { OTHER_VALUE } from '@shared/types.ts';
import { effectiveMaxPicks, isSingleSelect, textMaxChars, withDefaults } from '@shared/input-modes.ts';
import { parseNumber } from '@shared/answers.ts';
import { type Lang, pick, t } from './i18n.ts';
import { amountWords, formatInr } from './flow.ts';
import { SpeakAnswer, type VoiceCtx } from './SpeakAnswer.tsx';
import { Icon } from '../lib/icons.tsx';

export type { VoiceCtx };

interface Props {
  q: CompiledQuestion;
  lang: Lang;
  value: RawAnswer | undefined;
  onChange: (a: RawAnswer) => void;
  /** a single-select option was tapped and nothing else can be answered → advance */
  onPicked: () => void;
  ctx: VoiceCtx;
  uploads: number;
  onUploaded: (pending: boolean) => void;
  onBusy: (busy: boolean) => void;
}

const optionClass = (selected: boolean) =>
  `w-full rounded-xl border-2 px-4 py-4 text-left text-lg transition ${
    selected ? 'border-primary bg-primary-soft font-semibold text-ink' : 'border-line bg-surface text-ink hover:border-muted'
  }`;

export function QuestionInput(p: Props) {
  switch (p.q.kind) {
    case 'contact':
      return <Contact {...p} />;
    case 'yes_no':
      return (
        <Choose {...p} mode={{ enabled: true, style: 'radio', min_picks: null, max_picks: 1, allow_other: false, other_max_chars: 0 }} autoAdvance />
      );
    case 'date':
      return (
        <input
          type="date"
          className="r-input"
          value={p.value?.text ?? ''}
          min={typeof p.q.validation.min === 'string' ? p.q.validation.min : undefined}
          max={typeof p.q.validation.max === 'string' ? p.q.validation.max : undefined}
          aria-label={pick(p.lang, p.q.label_en, p.q.label_hi)}
          onChange={(e) => p.onChange({ ...p.value, text: e.target.value })}
        />
      );
    case 'standard':
      return <Standard {...p} />;
  }
}

function Standard(p: Props) {
  const m = withDefaults(p.q.input_modes);
  const order: InputMode[] = [m.primary, ...(['choose', 'type', 'speak'] as const).filter((x) => x !== m.primary && m[x].enabled)];
  const answered = (k: InputMode) =>
    k === 'choose' ? !!p.value?.choose?.length : k === 'type' ? !!p.value?.text && !p.value?.speech && !p.value?.voice : !!(p.value?.voice || p.value?.speech);
  const [open, setOpen] = useState<Set<InputMode>>(() => new Set(order.filter((k, i) => i === 0 || answered(k))));
  const onlyChoose = order.length === 1 && m.primary === 'choose';
  const linkText: Record<InputMode, Parameters<typeof t>[1]> = { choose: 'chooseInstead', type: 'typeInstead', speak: 'speakInstead' };
  return (
    <div className="space-y-5">
      {order.map((k) => {
        if (!open.has(k)) return null;
        if (k === 'choose') return <Choose key={k} {...p} mode={m.choose} autoAdvance={onlyChoose} />;
        if (k === 'type') return <TypeBox key={k} {...p} mode={m.type} maxChars={textMaxChars(m)} />;
        return <SpeakAnswer key={k} q={p.q} speak={m.speak} maxChars={textMaxChars(m)} lang={p.lang} value={p.value} onChange={p.onChange} ctx={p.ctx} uploads={p.uploads} onUploaded={p.onUploaded} onBusy={p.onBusy} />;
      })}
      {order.some((k) => !open.has(k)) && (
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {order
            .filter((k) => !open.has(k))
            .map((k) => (
              <button key={k} type="button" className="r-link text-base" onClick={() => setOpen((s) => new Set([...s, k]))}>
                {t(p.lang, linkText[k])}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

function Choose({ q, lang, value, onChange, onPicked, mode, autoAdvance }: Props & { mode: ChooseMode; autoAdvance?: boolean }) {
  const sel = value?.choose ?? [];
  const single = isSingleSelect(mode);
  const max = effectiveMaxPicks(mode);
  const opts = [...q.options.map((o) => ({ value: o.value, label: pick(lang, o.label_en, o.label_hi) })), ...(mode.allow_other ? [{ value: OTHER_VALUE, label: t(lang, 'other') }] : [])];
  const set = (choose: string[]) => onChange({ ...value, choose });
  const toggle = (v: string) => {
    if (single) {
      set([v]);
      if (v !== OTHER_VALUE && autoAdvance) onPicked();
      return;
    }
    const next = sel.includes(v) ? sel.filter((x) => x !== v) : [...sel, v];
    if (max && next.length > max) return;
    set(next);
  };
  const other = sel.includes(OTHER_VALUE) && (
    <div>
      <input
        autoFocus
        className="r-input"
        maxLength={mode.other_max_chars || 200}
        placeholder={t(lang, 'otherPlaceholder')}
        value={value?.other_text ?? ''}
        onChange={(e) => onChange({ ...value, choose: sel, other_text: e.target.value })}
      />
      <p className="mt-1 text-right text-xs text-muted">{(value?.other_text ?? '').length} / {mode.other_max_chars || 200}</p>
    </div>
  );
  const label = pick(lang, q.label_en, q.label_hi);

  if (mode.style === 'dropdown') {
    return (
      <div className="space-y-3">
        <select className="r-input" value={sel[0] ?? ''} aria-label={label} onChange={(e) => set(e.target.value ? [e.target.value] : [])}>
          <option value="">{t(lang, 'choose')}</option>
          {opts.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {other}
      </div>
    );
  }
  if (mode.style === 'chips') {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted">{t(lang, 'pickAll')}</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label={label}>
          {opts.map((o) => (
            <button key={o.value} type="button" role="checkbox" aria-checked={sel.includes(o.value)} onClick={() => toggle(o.value)}
              className={`rounded-full border-2 px-4 py-2 text-base ${sel.includes(o.value) ? 'border-primary bg-primary-soft font-semibold text-ink' : 'border-line bg-surface text-ink'}`}>
              {o.label}
            </button>
          ))}
        </div>
        {other}
      </div>
    );
  }
  return (
    <div className="space-y-3" role={single ? 'radiogroup' : 'group'} aria-label={label}>
      {!single && <p className="text-sm text-muted">{t(lang, 'pickAll')}</p>}
      {opts.map((o) => (
        <button key={o.value} type="button" role={single ? 'radio' : 'checkbox'} aria-checked={sel.includes(o.value)} className={optionClass(sel.includes(o.value))} onClick={() => toggle(o.value)}>
          {!single && <Icon name={sel.includes(o.value) ? 'checked' : 'unchecked'} size={22} className={`mr-2 inline-block align-[-5px] ${sel.includes(o.value) ? 'text-primary' : 'text-muted'}`} />}
          {o.label}
        </button>
      ))}
      {other}
    </div>
  );
}

function TypeBox({ q, lang, value, onChange, mode, maxChars }: Props & { mode: TypeMode; maxChars: number }) {
  // Typing and speaking share one text answer: while a spoken answer exists, it is edited in the speaking box.
  if (value?.speech || value?.voice) return <p className="text-sm text-muted">{t(lang, 'spokenAnswerAbove')}</p>;
  const text = value?.text ?? '';
  const numeric = mode.format === 'number' || mode.format === 'currency';
  const n = numeric && text ? parseNumber(text) : null;
  const placeholder = pick(lang, mode.placeholder_en ?? '', mode.placeholder_hi) || undefined;
  const common = {
    value: text,
    maxLength: maxChars,
    placeholder,
    'aria-label': pick(lang, q.label_en, q.label_hi),
    // typing replaces a spoken answer for this question
    onChange: (e: { target: { value: string } }) => onChange({ ...value, text: e.target.value, voice: false, speech: null }),
  };
  return (
    <div className="space-y-1">
      {mode.multiline ? (
        <textarea className="r-input min-h-32 resize-y" {...common} />
      ) : (
        <div className="relative">
          {mode.format === 'currency' && <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-xl text-muted">₹</span>}
          <input
            className={`r-input ${numeric ? 'text-2xl' : ''} ${mode.format === 'currency' ? 'pl-10' : ''}`}
            inputMode={numeric ? 'decimal' : mode.format === 'email' ? 'email' : 'text'}
            type={mode.format === 'email' ? 'email' : 'text'}
            autoComplete="off"
            {...common}
          />
        </div>
      )}
      <div className="flex justify-between text-xs text-muted" aria-live="polite">
        <span>{mode.format === 'currency' ? (n !== null ? `${formatInr(n)} ${amountWords(n, lang) ? `(${amountWords(n, lang)})` : ''}` : t(lang, 'amountHint')) : ''}</span>
        {!numeric && <span>{t(lang, 'charsLeft', { n: text.length, max: maxChars })}</span>}
      </div>
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
      <p className="text-muted">{t(lang, 'contactHelper')}</p>
      <div>
        <label className="mb-1 block text-sm font-medium text-ink" htmlFor="c-name">{t(lang, 'name')}</label>
        <input id="c-name" className="r-input" autoComplete="name" maxLength={80} value={c.name} onChange={(e) => set({ name: e.target.value })} />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-ink" htmlFor="c-phone">{t(lang, 'phone')}</label>
        <div className="flex">
          <span className="flex items-center rounded-l-xl border border-r-0 border-line bg-primary-soft px-3 text-muted">+91</span>
          <input id="c-phone" className="r-input rounded-l-none" type="tel" inputMode="tel" autoComplete="tel" maxLength={20} placeholder="98765 43210" value={c.phone} onChange={(e) => set({ phone: e.target.value })} />
        </div>
      </div>
      <label className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3 text-ink">
        <input type="checkbox" className="h-6 w-6 accent-[var(--primary)]" checked={c.whatsapp_ok} onChange={(e) => set({ whatsapp_ok: e.target.checked })} />
        <span>{t(lang, 'whatsapp')}</span>
      </label>
      <label className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3 text-ink">
        <input type="checkbox" className="h-6 w-6 accent-[var(--primary)]" checked={c.consent} onChange={(e) => set({ consent: e.target.checked })} />
        <span>{t(lang, 'consent')}</span>
      </label>
    </div>
  );
}
