// Editor for one question, shown in a side sheet: text, kind, input modes (Choose / Type / Speak),
// answer options, when-to-show, with a live phone preview of exactly what respondents see.
import { useEffect, useMemo, useState } from 'react';
import type { ChooseStyle, InputMode, InputModes, QuestionKind, ShowIf, TextFormat, Validation } from '@shared/types.ts';
import { CHOOSE_STYLES, PATH_KEY, QUESTION_KINDS, TEXT_FORMATS } from '@shared/types.ts';
import { type Issue, KEY_RE } from '@shared/validator.ts';
import { compileQuestion } from '@shared/compile.ts';
import { isSingleSelect, withDefaults } from '@shared/input-modes.ts';
import { QuestionPreview } from '../../respondent/QuestionPreview.tsx';
import type { OptionRow, QuestionRow } from '../types.ts';
import { SaveIndicator, type SaveState } from '../ui.tsx';
import { ShowIfEditor } from './ConditionEditor.tsx';
import { parseNumberInput, type RefQuestion } from './conditionValue.ts';
import { toDraft } from './draft.ts';
import { BOUNDS, checkModes, clampInt, KIND_LABEL, MODE_LABEL, patchMode, respondentHint, setModeEnabled, setPrimary, STYLE_LABEL } from './modes.ts';
import { OptionsEditor } from './OptionsEditor.tsx';

type Status = { state: SaveState; error: string | null };

export interface QuestionEditorProps {
  q: QuestionRow;
  earlier: RefQuestion[];
  issues: Issue[];
  status: Status;
  optionStatus: (id: string) => Status;
  takenKeys: Set<string>;
  brandName: string;
  onPatch: (patch: Partial<QuestionRow>) => void;
  onRetry: () => void;
  onUndo: () => void;
  onKindChange: (k: QuestionKind) => void;
  onRemove: () => void;
  onOptionPatch: (o: OptionRow, patch: Partial<OptionRow>) => void;
  onAddOption: (label: string) => void;
  onReorderOptions: (ids: string[]) => void;
  onRemoveOption: (o: OptionRow) => void;
  onRestoreOption: (o: OptionRow) => void;
}

const FORMAT_LABEL: Record<TextFormat, string> = { any: 'Any text', number: 'Number', currency: 'Amount in ₹', email: 'Email address' };

function TextField({ id, label, value, onChange, max, placeholder, multiline }: { id: string; label: string; value: string | null; onChange: (v: string) => void; max: number; placeholder?: string; multiline?: boolean }) {
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      {multiline ? (
        <textarea id={id} className="input min-h-16" maxLength={max} value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input id={id} className="input" maxLength={max} value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}

/** Number input with bounds; empty = no limit (when allowed). */
export function BoundedNumber({ id, label, value, onChange, min, max, allowEmpty = true, error, hint }: {
  id: string; label: string; value: number | null; onChange: (n: number | null) => void; min: number; max: number; allowEmpty?: boolean; error?: string; hint?: string;
}) {
  const [text, setText] = useState(value === null ? '' : String(value));
  useEffect(() => setText(value === null ? '' : String(value)), [value]);
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        className={`input ${error ? 'border-red-400' : ''}`}
        value={text}
        placeholder={allowEmpty ? 'No limit' : undefined}
        aria-invalid={!!error}
        onChange={(e) => {
          setText(e.target.value);
          const n = parseNumberInput(e.target.value);
          if (e.target.value.trim() === '' && allowEmpty) onChange(null);
          else if (n !== null) onChange(n);
        }}
        onBlur={() => {
          const n = parseNumberInput(text);
          const c = n === null ? (allowEmpty ? null : min) : clampInt(n, min, max);
          setText(c === null ? '' : String(c));
          if (c !== value) onChange(c);
        }}
      />
      {error ? <p className="mt-1 text-xs text-red-700">{error}</p> : hint ? <p className="mt-1 text-xs text-stone-500">{hint}</p> : null}
    </div>
  );
}

function Toggle({ id, label, checked, onChange, disabled }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label htmlFor={id} className="flex items-center gap-2 text-sm">
      <input id={id} type="checkbox" className="h-4 w-4 accent-brand-700" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function ModePanel({ mode, modes, locked, onToggle, children }: { mode: InputMode; modes: InputModes; locked: boolean; onToggle: (on: boolean) => void; children: React.ReactNode }) {
  const on = modes[mode].enabled;
  const [open, setOpen] = useState(on);
  useEffect(() => setOpen(on), [on]);
  const id = `mode-${mode}`;
  return (
    <section className={`rounded-xl border ${on ? 'border-brand-200 bg-white' : 'border-stone-200 bg-stone-50'}`}>
      <div className="flex items-center gap-3 p-3">
        <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={`${id}-body`}>
          <span className="text-stone-400">{open ? '▾' : '▸'}</span>
          <span className="font-medium">{MODE_LABEL[mode]}</span>
          {modes.primary === mode && on && <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs text-brand-800">primary</span>}
        </button>
        <label className="flex items-center gap-2 text-sm">
          <span className="sr-only">{MODE_LABEL[mode]} on/off</span>
          <span className="text-stone-500">{on ? 'On' : 'Off'}</span>
          <input
            type="checkbox"
            role="switch"
            aria-label={`${MODE_LABEL[mode]} on/off`}
            className="h-5 w-9 cursor-pointer accent-brand-700"
            checked={on}
            disabled={locked}
            onChange={(e) => onToggle(e.target.checked)}
          />
        </label>
      </div>
      {open && (
        <fieldset id={`${id}-body`} disabled={!on || locked} className="space-y-3 border-t border-stone-100 p-3 disabled:opacity-60">
          {children}
        </fieldset>
      )}
    </section>
  );
}

export function QuestionEditor(p: QuestionEditorProps) {
  const { q } = p;
  const isPath = q.key === PATH_KEY;
  const published = !!q.first_published_at;
  const [keyText, setKeyText] = useState(q.key);
  const [keyErr, setKeyErr] = useState<string | null>(null);
  const [lang, setLang] = useState<'en' | 'hi'>('en');
  useEffect(() => setKeyText(q.key), [q.key]);
  const id = (s: string) => `q-${q.id}-${s}`;
  const v: Validation = q.validation ?? {};
  const setV = (k: 'min' | 'max', val: number | string | null) => {
    const next: Record<string, unknown> = { ...v };
    if (val === null || val === '') delete next[k];
    else next[k] = val;
    p.onPatch({ validation: next as Validation });
  };

  // input modes are edited locally and only saved when valid (never save a broken object)
  const [modes, setModesLocal] = useState<InputModes | null>(q.input_modes ? withDefaults(q.input_modes) : null);
  useEffect(() => {
    setModesLocal(q.input_modes ? withDefaults(q.input_modes) : null);
    // reset only when switching question or kind; local edits win otherwise
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.id, q.kind]);
  const check = useMemo(() => (modes ? checkModes(modes) : { ok: true, errors: {} as Record<string, string> }), [modes]);
  const updateModes = (m: InputModes) => {
    setModesLocal(m);
    if (checkModes(m).ok) p.onPatch({ input_modes: m });
  };
  const err = (path: string) => check.errors[path];

  const preview = useMemo(() => compileQuestion(toDraft({ ...q, input_modes: modes })), [q, modes]);
  const choosing = q.kind === 'standard' && !!modes?.choose.enabled;

  function commitKey() {
    const k = keyText.trim();
    if (k === q.key) return setKeyErr(null);
    if (!KEY_RE.test(k)) return setKeyErr('Use lowercase letters, numbers and _ and start with a letter (max 40).');
    if (p.takenKeys.has(k)) return setKeyErr('Another question (maybe archived) already uses this key.');
    setKeyErr(null);
    p.onPatch({ key: k });
  }

  return (
    <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0 space-y-4">
        {p.issues.length > 0 && (
          <ul className="space-y-1 rounded-xl bg-red-50 p-3 text-sm" aria-label="Problems with this question">
            {p.issues.map((i, n) => (
              <li key={n} className={i.level === 'error' ? 'text-red-800' : 'text-amber-800'}>
                {i.level === 'error' ? '⚠ ' : 'ℹ '}
                {i.message}
              </li>
            ))}
          </ul>
        )}
        {!check.ok && (
          <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            Unsaved — fix the highlighted fields.
            {check.errors[''] && <span className="block">{check.errors['']}</span>}
            {check.errors['primary'] && <span className="block">{check.errors['primary']}</span>}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <SaveIndicator state={p.status.state} error={p.status.error} onRetry={p.onRetry} />
          {p.status.state === 'error' && (
            <button className="text-xs text-stone-600 underline" onClick={p.onUndo}>
              undo my change
            </button>
          )}
          <span className="text-stone-500">{published ? 'Published — can be archived, not deleted' : 'Never published — can be deleted'}</span>
        </div>

        <section className="card space-y-3 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField id={id('label_en')} label="Question (English)" value={q.label_en} max={300} onChange={(x) => p.onPatch({ label_en: x })} multiline />
            <TextField id={id('label_hi')} label="Question (Hindi)" value={q.label_hi} max={300} onChange={(x) => p.onPatch({ label_hi: x || null })} multiline />
            <TextField id={id('help_en')} label="Help text (English)" value={q.help_en} max={500} onChange={(x) => p.onPatch({ help_en: x || null })} />
            <TextField id={id('help_hi')} label="Help text (Hindi)" value={q.help_hi} max={500} onChange={(x) => p.onPatch({ help_hi: x || null })} />
            <div>
              <label className="label" htmlFor={id('kind')}>
                Kind of question
              </label>
              <select id={id('kind')} className="input" value={q.kind} disabled={isPath || q.kind === 'contact'} onChange={(e) => p.onKindChange(e.target.value as QuestionKind)}>
                {QUESTION_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </select>
              {published && !isPath && <p className="mt-1 text-xs text-stone-500">Changing the kind of a published question creates a new question.</p>}
            </div>
            <div>
              <label className="label" htmlFor={id('key')}>
                Key {published || isPath ? '(locked)' : ''}
              </label>
              <input
                id={id('key')}
                className="input font-mono text-sm"
                value={keyText}
                disabled={published || isPath}
                onChange={(e) => setKeyText(e.target.value.toLowerCase())}
                onBlur={commitKey}
                maxLength={40}
              />
              {keyErr && <p className="mt-1 text-xs text-red-700">{keyErr}</p>}
            </div>
          </div>
          {q.kind !== 'contact' && <Toggle id={id('req')} label="Required" checked={q.required} disabled={isPath} onChange={(x) => p.onPatch({ required: x })} />}
          {q.kind === 'contact' && (
            <p className="rounded-xl bg-stone-50 p-3 text-sm text-stone-600">
              One screen: name, mobile number (India by default), “OK to WhatsApp” (on by default) and a consent tick box. Always required and shown to everyone.
            </p>
          )}
          {q.kind === 'yes_no' && <p className="text-sm text-stone-500">Answers are fixed: Yes / No.</p>}
          {q.kind === 'date' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor={id('dmin')}>
                  Earliest date
                </label>
                <input id={id('dmin')} type="date" className="input" value={String(v.min ?? '')} onChange={(e) => setV('min', e.target.value || null)} />
              </div>
              <div>
                <label className="label" htmlFor={id('dmax')}>
                  Latest date
                </label>
                <input id={id('dmax')} type="date" className="input" value={String(v.max ?? '')} onChange={(e) => setV('max', e.target.value || null)} />
              </div>
            </div>
          )}
        </section>

        {q.kind === 'standard' && modes && (
          <section className="space-y-3" aria-label="Ways to answer">
            <div className="flex flex-wrap items-end gap-3">
              <h3 className="mr-auto font-semibold">Ways to answer</h3>
              <div>
                <label className="label" htmlFor={id('primary')}>
                  Primary
                </label>
                <select id={id('primary')} className="input w-auto py-1.5" value={modes.primary} disabled={isPath} onChange={(e) => updateModes(setPrimary(modes, e.target.value as InputMode))}>
                  {(['choose', 'type', 'speak'] as const)
                    .filter((m) => modes[m].enabled)
                    .map((m) => (
                      <option key={m} value={m}>
                        {MODE_LABEL[m]}
                      </option>
                    ))}
                </select>
              </div>
            </div>
            {isPath && <p className="text-xs text-stone-500">The first question is always “choose one”: it decides which questions follow.</p>}
            <p className="text-xs text-stone-500">{respondentHint(modes)} Any combination may be answered.</p>

            <ModePanel mode="choose" modes={modes} locked={isPath} onToggle={(on) => updateModes(setModeEnabled(modes, 'choose', on))}>
              <div>
                <span className="label">Style</span>
                <div className="grid gap-2 sm:grid-cols-2">
                  {CHOOSE_STYLES.map((st) => (
                    <label key={st} className="flex items-center gap-2 text-sm">
                      <input type="radio" name={id('style')} value={st} checked={modes.choose.style === st} disabled={isPath && st !== 'radio' && st !== 'dropdown'} onChange={() => updateModes(patchMode(modes, 'choose', { style: st as ChooseStyle }))} />
                      {STYLE_LABEL[st]}
                    </label>
                  ))}
                </div>
              </div>
              {!isSingleSelect(modes.choose) && (
                <div className="grid grid-cols-2 gap-3">
                  <BoundedNumber id={id('minp')} label="Pick at least" value={modes.choose.min_picks} {...BOUNDS.picks} error={err('choose.min_picks')} onChange={(n) => updateModes(patchMode(modes, 'choose', { min_picks: n }))} />
                  <BoundedNumber id={id('maxp')} label="Pick at most" value={modes.choose.max_picks} min={1} max={BOUNDS.picks.max} error={err('choose.max_picks')} onChange={(n) => updateModes(patchMode(modes, 'choose', { max_picks: n }))} />
                </div>
              )}
              <Toggle id={id('other')} label="Allow “Other” (typed)" checked={modes.choose.allow_other} disabled={isPath} onChange={(x) => updateModes(patchMode(modes, 'choose', { allow_other: x }))} />
              {modes.choose.allow_other && (
                <div className="w-48">
                  <BoundedNumber id={id('othermax')} label="“Other” max characters" value={modes.choose.other_max_chars} {...BOUNDS.otherChars} allowEmpty={false} error={err('choose.other_max_chars')} onChange={(n) => updateModes(patchMode(modes, 'choose', { other_max_chars: n ?? 200 }))} />
                </div>
              )}
            </ModePanel>

            <ModePanel mode="type" modes={modes} locked={isPath} onToggle={(on) => updateModes(setModeEnabled(modes, 'type', on))}>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor={id('format')}>
                    Format
                  </label>
                  <select id={id('format')} className="input" value={modes.type.format} onChange={(e) => updateModes(patchMode(modes, 'type', { format: e.target.value as TextFormat }))}>
                    {TEXT_FORMATS.map((f) => (
                      <option key={f} value={f}>
                        {FORMAT_LABEL[f]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end pb-2">
                  <Toggle id={id('multi')} label="Several lines (long answer)" checked={modes.type.multiline} onChange={(x) => updateModes(patchMode(modes, 'type', { multiline: x }))} />
                </div>
                <BoundedNumber id={id('minc')} label="Minimum characters" value={modes.type.min_chars} {...BOUNDS.chars} error={err('type.min_chars')} onChange={(n) => updateModes(patchMode(modes, 'type', { min_chars: n }))} />
                <BoundedNumber id={id('maxc')} label="Maximum characters" value={modes.type.max_chars} min={1} max={BOUNDS.chars.max} error={err('type.max_chars')} hint="Respondents see a live counter." onChange={(n) => updateModes(patchMode(modes, 'type', { max_chars: n }))} />
                <TextField id={id('ph_en')} label="Placeholder (English)" value={modes.type.placeholder_en} max={120} onChange={(x) => updateModes(patchMode(modes, 'type', { placeholder_en: x || null }))} />
                <TextField id={id('ph_hi')} label="Placeholder (Hindi)" value={modes.type.placeholder_hi} max={120} onChange={(x) => updateModes(patchMode(modes, 'type', { placeholder_hi: x || null }))} />
              </div>
              {(modes.type.format === 'number' || modes.type.format === 'currency') && (
                <div className="grid grid-cols-2 gap-3">
                  <BoundedNumber id={id('vmin')} label="Smallest allowed value" value={typeof v.min === 'number' ? v.min : null} min={-1e12} max={1e12} onChange={(n) => setV('min', n)} />
                  <BoundedNumber id={id('vmax')} label="Largest allowed value" value={typeof v.max === 'number' ? v.max : null} min={-1e12} max={1e12} onChange={(n) => setV('max', n)} />
                </div>
              )}
            </ModePanel>

            <ModePanel mode="speak" modes={modes} locked={isPath} onToggle={(on) => updateModes(setModeEnabled(modes, 'speak', on))}>
              <div className="w-56">
                <BoundedNumber id={id('secs')} label="Longest recording (seconds)" value={modes.speak.max_seconds} {...BOUNDS.seconds} allowEmpty={false} error={err('speak.max_seconds')} onChange={(n) => updateModes(patchMode(modes, 'speak', { max_seconds: n ?? 120 }))} />
              </div>
              <Toggle id={id('live')} label="Show words live while they speak (where the browser supports it)" checked={modes.speak.live_transcript} onChange={(x) => updateModes(patchMode(modes, 'speak', { live_transcript: x }))} />
              <Toggle id={id('edit')} label="Let them correct the written text before sending" checked={modes.speak.allow_edit} onChange={(x) => updateModes(patchMode(modes, 'speak', { allow_edit: x }))} />
              <Toggle id={id('keep')} label="Keep the audio recording (needed for the clearer Whisper transcript and playback)" checked={modes.speak.keep_audio} onChange={(x) => updateModes(patchMode(modes, 'speak', { keep_audio: x }))} />
              {!modes.speak.keep_audio && <p className="text-xs text-amber-800">Without audio you only get what the browser wrote down live; nothing to replay later.</p>}
            </ModePanel>
          </section>
        )}

        {choosing && (
          <OptionsEditor
            q={q}
            isPath={isPath}
            optionStatus={p.optionStatus}
            onRetry={p.onRetry}
            onPatch={p.onOptionPatch}
            onAdd={p.onAddOption}
            onReorder={p.onReorderOptions}
            onRemove={p.onRemoveOption}
            onRestore={p.onRestoreOption}
          />
        )}

        {!isPath && q.kind !== 'contact' && (
          <section className="card p-4">
            <h4 className="label">When to show this question</h4>
            <ShowIfEditor value={q.show_if as ShowIf | null} refs={p.earlier} onChange={(s) => p.onPatch({ show_if: s })} />
          </section>
        )}

        {!isPath && (
          <div className="border-t border-stone-200 pt-3">
            <button className="btn-ghost px-3 py-1.5 text-sm text-red-700" onClick={p.onRemove}>
              {published ? 'Archive this question' : 'Delete this question'}
            </button>
          </div>
        )}
      </div>

      <aside className="lg:sticky lg:top-4 lg:self-start" aria-label="Phone preview">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium text-stone-600">Live preview</span>
          <div className="flex rounded-full border border-stone-300 p-0.5 text-xs" role="group" aria-label="Preview language">
            {(['en', 'hi'] as const).map((l) => (
              <button key={l} className={`rounded-full px-3 py-1 ${lang === l ? 'bg-stone-900 text-white' : ''}`} aria-pressed={lang === l} onClick={() => setLang(l)}>
                {l === 'en' ? 'English' : 'हिंदी'}
              </button>
            ))}
          </div>
        </div>
        <div className="mx-auto w-[360px] max-w-full overflow-hidden rounded-[2rem] border-8 border-stone-800 bg-[#FAF8F4] shadow-xl">
          <div className="h-[640px] overflow-y-auto">
            <QuestionPreview question={preview} lang={lang} brandName={p.brandName} />
          </div>
        </div>
        <p className="mt-2 text-center text-xs text-stone-500">Updates as you type. Voice is simulated in the preview.</p>
      </aside>
    </div>
  );
}
