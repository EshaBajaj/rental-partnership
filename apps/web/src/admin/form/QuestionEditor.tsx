// Editor for one question (fields, options, show-if).
import { useEffect, useState } from 'react';
import type { QuestionType, ShowIf, Validation } from '@shared/types.ts';
import { PATH_KEY, QUESTION_TYPES } from '@shared/types.ts';
import { type Issue, KEY_RE } from '@shared/validator.ts';
import type { OptionRow, QuestionRow } from '../types.ts';
import { SaveIndicator, type SaveState } from '../ui.tsx';
import { ShowIfEditor } from './ConditionEditor.tsx';
import { parseNumberInput, type RefQuestion } from './conditionValue.ts';

export const TYPE_LABEL: Record<QuestionType, string> = {
  single: 'Single choice',
  multi: 'Multiple choice',
  dropdown: 'Dropdown',
  yes_no: 'Yes / No',
  short_text: 'Short text',
  long_text: 'Long text',
  number: 'Number',
  currency: 'Amount (₹)',
  date: 'Date',
  voice: 'Voice (speak or type)',
  contact: 'Contact details',
};

type Status = { state: SaveState; error: string | null };

export interface QuestionEditorProps {
  q: QuestionRow;
  earlier: RefQuestion[];
  issues: Issue[];
  status: Status;
  optionStatus: (id: string) => Status;
  takenKeys: Set<string>;
  onPatch: (patch: Partial<QuestionRow>) => void;
  onRetry: () => void;
  onUndo: () => void;
  onTypeChange: (t: QuestionType) => void;
  onRemove: () => void;
  onOptionPatch: (o: OptionRow, patch: Partial<OptionRow>) => void;
  onAddOption: (label: string) => void;
  onMoveOption: (o: OptionRow, dir: -1 | 1) => void;
  onRemoveOption: (o: OptionRow) => void;
  onRestoreOption: (o: OptionRow) => void;
}

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

function NumField({ id, label, value, onChange, integer }: { id: string; label: string; value: unknown; onChange: (n: number | null) => void; integer?: boolean }) {
  const [text, setText] = useState(value === undefined || value === null ? '' : String(value));
  useEffect(() => {
    if (parseNumberInput(text) !== (value ?? null)) setText(value === undefined || value === null ? '' : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="input"
        inputMode={integer ? 'numeric' : 'decimal'}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const n = parseNumberInput(e.target.value);
          if (n !== null || e.target.value.trim() === '') onChange(n === null ? null : integer ? Math.round(n) : n);
        }}
      />
    </div>
  );
}

export function QuestionEditor(p: QuestionEditorProps) {
  const { q } = p;
  const isPath = q.key === PATH_KEY;
  const published = !!q.first_published_at;
  const isChoice = q.type === 'single' || q.type === 'multi' || q.type === 'dropdown';
  const [keyText, setKeyText] = useState(q.key);
  const [keyErr, setKeyErr] = useState<string | null>(null);
  const [newOpt, setNewOpt] = useState('');
  useEffect(() => setKeyText(q.key), [q.key]);
  const id = (s: string) => `q-${q.id}-${s}`;
  const v: Validation = q.validation ?? {};
  const setV = (k: keyof Validation, val: number | string | null) => {
    const next: Record<string, unknown> = { ...v };
    if (val === null || val === '') delete next[k];
    else next[k] = val;
    p.onPatch({ validation: next as Validation });
  };
  const activeOpts = q.question_options.filter((o) => !o.archived_at).sort((a, b) => a.position - b.position);
  const archivedOpts = q.question_options.filter((o) => o.archived_at);

  function commitKey() {
    const k = keyText.trim();
    if (k === q.key) return setKeyErr(null);
    if (!KEY_RE.test(k)) return setKeyErr('Use lowercase letters, numbers and _ and start with a letter (max 40).');
    if (p.takenKeys.has(k)) return setKeyErr('Another question (maybe archived) already uses this key.');
    setKeyErr(null);
    p.onPatch({ key: k });
  }

  return (
    <div className="space-y-4">
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
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <SaveIndicator state={p.status.state} error={p.status.error} onRetry={p.onRetry} />
        {p.status.state === 'error' && (
          <button className="text-xs text-stone-600 underline" onClick={p.onUndo}>
            undo my change
          </button>
        )}
        <span className="text-stone-500">{published ? 'Published — can be archived, not deleted' : 'Never published — can be deleted'}</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={id('type')}>
            Type
          </label>
          <select id={id('type')} className="input" value={q.type} disabled={isPath} onChange={(e) => p.onTypeChange(e.target.value as QuestionType)}>
            {QUESTION_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
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
        <TextField id={id('label_en')} label="Question (English)" value={q.label_en} max={300} onChange={(x) => p.onPatch({ label_en: x })} multiline />
        <TextField id={id('label_hi')} label="Question (Hindi)" value={q.label_hi} max={300} onChange={(x) => p.onPatch({ label_hi: x || null })} multiline />
        <TextField id={id('help_en')} label="Help text (English)" value={q.help_en} max={500} onChange={(x) => p.onPatch({ help_en: x || null })} />
        <TextField id={id('help_hi')} label="Help text (Hindi)" value={q.help_hi} max={500} onChange={(x) => p.onPatch({ help_hi: x || null })} />
        {['short_text', 'long_text', 'number', 'currency', 'voice'].includes(q.type) && (
          <TextField id={id('ph')} label="Placeholder" value={q.placeholder} max={120} onChange={(x) => p.onPatch({ placeholder: x || null })} />
        )}
      </div>

      <div className="flex flex-wrap gap-4 text-sm">
        {q.type !== 'contact' && (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={q.required} disabled={isPath} onChange={(e) => p.onPatch({ required: e.target.checked })} /> Required
          </label>
        )}
        {isChoice && !isPath && (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={q.allow_other} onChange={(e) => p.onPatch({ allow_other: e.target.checked })} /> Allow “Other” (typed)
          </label>
        )}
        {(q.type === 'short_text' || q.type === 'long_text') && (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={q.allow_voice} onChange={(e) => p.onPatch({ allow_voice: e.target.checked })} /> Allow answering by voice
          </label>
        )}
      </div>

      {(q.type === 'number' || q.type === 'currency') && (
        <div className="grid grid-cols-2 gap-3">
          <NumField id={id('min')} label="Minimum" value={v.min} onChange={(n) => setV('min', n)} />
          <NumField id={id('max')} label="Maximum" value={v.max} onChange={(n) => setV('max', n)} />
        </div>
      )}
      {q.type === 'date' && (
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
      {(q.type === 'short_text' || q.type === 'long_text' || q.type === 'voice') && (
        <div className="w-48">
          <NumField id={id('maxlen')} label="Maximum length" value={v.maxLength} integer onChange={(n) => setV('maxLength', n)} />
        </div>
      )}
      {q.type === 'multi' && (
        <div className="grid grid-cols-2 gap-3">
          <NumField id={id('minp')} label="Pick at least" value={v.minPicks} integer onChange={(n) => setV('minPicks', n)} />
          <NumField id={id('maxp')} label="Pick at most" value={v.maxPicks} integer onChange={(n) => setV('maxPicks', n)} />
        </div>
      )}
      {q.type === 'contact' && (
        <p className="rounded-xl bg-stone-50 p-3 text-sm text-stone-600">
          One screen: name, mobile number (India by default), “OK to WhatsApp” (on by default) and a consent tick box. Always required and shown to everyone.
        </p>
      )}
      {q.type === 'yes_no' && <p className="text-sm text-stone-500">Answers are fixed: Yes / No.</p>}

      {isChoice && (
        <div>
          <h4 className="label">Answer options</h4>
          {isPath && <p className="mb-2 text-xs text-stone-500">These three answers decide which questions follow. You can change the wording only.</p>}
          <ul className="space-y-2">
            {activeOpts.map((o, i) => {
              const st = p.optionStatus(o.id);
              return (
                <li key={o.id} className="flex flex-wrap items-center gap-2">
                  <div className="flex flex-col">
                    <button className="px-1 text-xs text-stone-500 disabled:opacity-30" disabled={i === 0} onClick={() => p.onMoveOption(o, -1)} aria-label={`Move ${o.label_en} up`}>
                      ▲
                    </button>
                    <button className="px-1 text-xs text-stone-500 disabled:opacity-30" disabled={i === activeOpts.length - 1} onClick={() => p.onMoveOption(o, 1)} aria-label={`Move ${o.label_en} down`}>
                      ▼
                    </button>
                  </div>
                  <input aria-label="Option (English)" className="input min-w-0 flex-1 py-1.5" maxLength={200} value={o.label_en} onChange={(e) => p.onOptionPatch(o, { label_en: e.target.value })} />
                  <input aria-label="Option (Hindi)" className="input min-w-0 flex-1 py-1.5" maxLength={200} placeholder="हिंदी" value={o.label_hi ?? ''} onChange={(e) => p.onOptionPatch(o, { label_hi: e.target.value || null })} />
                  <code className="text-xs text-stone-500" title={o.first_published_at ? 'Locked: published' : 'Value'}>
                    {o.value}
                    {o.first_published_at ? ' 🔒' : ''}
                  </code>
                  <SaveIndicator state={st.state} error={st.error} onRetry={p.onRetry} />
                  {!isPath && (
                    <button className="btn-ghost px-2 py-1 text-sm text-red-700" onClick={() => p.onRemoveOption(o)}>
                      {o.first_published_at ? 'Archive' : 'Delete'}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {!isPath && (
            <form
              className="mt-2 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (newOpt.trim()) {
                  p.onAddOption(newOpt.trim());
                  setNewOpt('');
                }
              }}
            >
              <label className="sr-only" htmlFor={id('newopt')}>
                New option
              </label>
              <input id={id('newopt')} className="input py-1.5" placeholder="Add an option…" maxLength={200} value={newOpt} onChange={(e) => setNewOpt(e.target.value)} />
              <button className="btn-secondary px-3 py-1.5" disabled={!newOpt.trim()}>
                Add
              </button>
            </form>
          )}
          {archivedOpts.length > 0 && (
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer text-stone-500">Archived options ({archivedOpts.length})</summary>
              <ul className="mt-1 space-y-1">
                {archivedOpts.map((o) => (
                  <li key={o.id} className="flex items-center gap-2">
                    <span className="text-stone-500 line-through">{o.label_en}</span>
                    <button className="text-xs underline" onClick={() => p.onRestoreOption(o)}>
                      restore
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {!isPath && q.type !== 'contact' && (
        <div>
          <h4 className="label">When to show this question</h4>
          <ShowIfEditor value={q.show_if as ShowIf | null} refs={p.earlier} onChange={(s) => p.onPatch({ show_if: s })} />
        </div>
      )}

      {!isPath && (
        <div className="border-t border-stone-100 pt-3">
          <button className="btn-ghost px-3 py-1.5 text-sm text-red-700" onClick={p.onRemove}>
            {published ? 'Archive this question' : 'Delete this question'}
          </button>
        </div>
      )}
    </div>
  );
}
