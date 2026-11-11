// Visual condition builder: value editor, single condition row, nestable all/any groups.
import { useEffect, useState } from 'react';
import type { Cond, Op, ShowIf, ShowIfNode } from '@shared/types.ts';
import { groupItems, isCond } from '@shared/showif.ts';
import { opLabel } from '@shared/validator.ts';
import {
  appendAt,
  choiceOptions,
  coerceValue,
  isChoice,
  isDate,
  isNumeric,
  opsFor,
  LIST_OPS,
  newCondition,
  NO_VALUE_OPS,
  parseNumberInput,
  pruneShowIf,
  type RefQuestion,
  replaceAt,
  toggleGroupKind,
  type TreePath,
} from './conditionValue.ts';

let uid = 0;
const nextId = () => `ce-${++uid}`;

function NumberInput({ value, onChange, label }: { value: unknown; onChange: (n: number | '') => void; label: string }) {
  const [text, setText] = useState(value === undefined || value === null || value === '' ? '' : String(value));
  useEffect(() => {
    const parsed = parseNumberInput(text);
    if (parsed !== value && !(text === '' && value === '')) setText(value === undefined || value === null || value === '' ? '' : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      aria-label={label}
      inputMode="decimal"
      className="input w-32 py-1.5"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const n = parseNumberInput(e.target.value);
        onChange(n === null ? '' : n);
      }}
    />
  );
}

export function ValueEditor({ refQ, op, value, onChange }: { refQ: RefQuestion | undefined; op: Op; value: unknown; onChange: (v: unknown) => void }) {
  if (NO_VALUE_OPS.includes(op)) return null;
  if (!refQ) return <input aria-label="Value" className="input w-40 py-1.5" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
  if (isChoice(refQ)) {
    const opts = choiceOptions(refQ);
    if (LIST_OPS.includes(op)) {
      const sel = Array.isArray(value) ? value.map(String) : [];
      return (
        <div className="flex flex-wrap gap-1" role="group" aria-label="Values">
          {opts.map((o) => {
            const on = sel.includes(o.value);
            if (o.archived && !on) return null;
            return (
              <label key={o.value} className={`flex cursor-pointer items-center gap-1 rounded-full px-2 py-1 text-xs ring-1 ${on ? 'bg-brand-50 ring-brand-500' : 'ring-stone-300'} ${o.archived ? 'line-through' : ''}`}>
                <input type="checkbox" className="sr-only" checked={on} onChange={() => onChange(on ? sel.filter((x) => x !== o.value) : [...sel, o.value])} />
                {o.label_en}
              </label>
            );
          })}
        </div>
      );
    }
    return (
      <select aria-label="Value" className="input w-auto py-1.5" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
        <option value="">— pick —</option>
        {opts.map((o) => (
          <option key={o.value} value={o.value} disabled={o.archived && o.value !== value}>
            {o.label_en}
            {o.archived ? ' (archived)' : ''}
          </option>
        ))}
      </select>
    );
  }
  if (isNumeric(refQ)) {
    if (op === 'between') {
      const v = Array.isArray(value) ? value : ['', ''];
      return (
        <span className="flex items-center gap-1">
          <NumberInput label="From" value={v[0]} onChange={(n) => onChange([n, v[1]])} /> and <NumberInput label="To" value={v[1]} onChange={(n) => onChange([v[0], n])} />
        </span>
      );
    }
    return <NumberInput label="Value" value={value} onChange={onChange} />;
  }
  if (isDate(refQ)) {
    if (op === 'between') {
      const v = Array.isArray(value) ? value : ['', ''];
      return (
        <span className="flex items-center gap-1">
          <input aria-label="From" type="date" className="input w-auto py-1.5" value={String(v[0] ?? '')} onChange={(e) => onChange([e.target.value, v[1]])} /> and{' '}
          <input aria-label="To" type="date" className="input w-auto py-1.5" value={String(v[1] ?? '')} onChange={(e) => onChange([v[0], e.target.value])} />
        </span>
      );
    }
    return <input aria-label="Value" type="date" className="input w-auto py-1.5" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
  }
  return <input aria-label="Value" className="input w-48 py-1.5" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
}

/** One {q, op, v} row. `refs` = questions that may be referenced. */
export function ConditionRow({
  cond,
  refs,
  onChange,
  onRemove,
  extra,
  error,
}: {
  cond: { q: string; op: Op; v?: unknown };
  refs: RefQuestion[];
  onChange: (c: Cond) => void;
  onRemove?: () => void;
  extra?: React.ReactNode;
  error?: string[];
}) {
  const refQ = refs.find((r) => r.key === cond.q);
  const ops = refQ ? opsFor(refQ) : (['answered', 'not_answered'] as Op[]);
  const id = nextId();
  return (
    <div className={`rounded-xl border p-2 ${error?.length ? 'border-red-300 bg-red-50' : 'border-stone-200 bg-white'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`${id}-q`}>
          Question
        </label>
        <select
          id={`${id}-q`}
          className="input w-auto max-w-[16rem] py-1.5"
          value={cond.q}
          onChange={(e) => {
            const r = refs.find((x) => x.key === e.target.value);
            onChange(newCondition(r, e.target.value));
          }}
        >
          {!refQ && <option value={cond.q}>{cond.q ? `${cond.q} (missing)` : '— question —'}</option>}
          {refs.map((r) => (
            <option key={r.key} value={r.key}>
              {r.label_en}
              {r.archived ? ' (archived)' : ''}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor={`${id}-op`}>
          Comparison
        </label>
        <select
          id={`${id}-op`}
          className="input w-auto py-1.5"
          value={cond.op}
          onChange={(e) => {
            const op = e.target.value as Op;
            const v = coerceValue(op, refQ, cond.v);
            onChange(v === undefined ? { q: cond.q, op } : { q: cond.q, op, v });
          }}
        >
          {!ops.includes(cond.op) && <option value={cond.op}>{opLabel(cond.op)} (not valid)</option>}
          {ops.map((o) => (
            <option key={o} value={o}>
              {opLabel(o)}
            </option>
          ))}
        </select>
        <ValueEditor refQ={refQ} op={cond.op} value={cond.v} onChange={(v) => onChange({ q: cond.q, op: cond.op, v })} />
        {extra}
        {onRemove && (
          <button type="button" className="btn-ghost ml-auto px-2 py-1 text-stone-500" onClick={onRemove} aria-label="Remove condition">
            ✕
          </button>
        )}
      </div>
      {error?.map((m) => (
        <p key={m} className="mt-1 text-xs text-red-700">
          {m}
        </p>
      ))}
    </div>
  );
}

const MAX_DEPTH = 3;

function GroupEditor({ root, path, refs, onChange }: { root: ShowIf; path: TreePath; refs: RefQuestion[]; onChange: (s: ShowIf) => void }) {
  let node: ShowIfNode = root;
  for (const i of path) node = groupItems(node as ShowIf)[i];
  const g = node as ShowIf;
  const items = groupItems(g);
  const firstRef = refs[0];
  return (
    <div className={`space-y-2 rounded-xl ${path.length ? 'border border-dashed border-stone-300 bg-stone-50 p-2' : ''}`}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>Show when</span>
        <button type="button" className="rounded-full bg-stone-200 px-3 py-0.5 font-medium" onClick={() => onChange(replaceAt(root, path, toggleGroupKind(g)))}>
          {'all' in g ? 'ALL' : 'ANY'}
        </button>
        <span>of these are true</span>
        {path.length > 0 && (
          <button type="button" className="ml-auto text-xs text-stone-500 underline" onClick={() => onChange(replaceAt(root, path, null))}>
            remove group
          </button>
        )}
      </div>
      {items.map((it, i) =>
        isCond(it) ? (
          <ConditionRow
            key={i}
            cond={it}
            refs={refs}
            onChange={(c) => onChange(replaceAt(root, [...path, i], c))}
            onRemove={() => onChange(replaceAt(root, [...path, i], null))}
          />
        ) : (
          <GroupEditor key={i} root={root} path={[...path, i]} refs={refs} onChange={onChange} />
        ),
      )}
      <div className="flex gap-2">
        <button type="button" className="btn-secondary px-3 py-1 text-sm" disabled={!firstRef} onClick={() => onChange(appendAt(root, path, newCondition(firstRef, firstRef?.key ?? '')))}>
          + Condition
        </button>
        {path.length < MAX_DEPTH - 1 && (
          <button
            type="button"
            className="btn-ghost px-3 py-1 text-sm"
            disabled={!firstRef}
            onClick={() => onChange(appendAt(root, path, { [('all' in g ? 'any' : 'all') as 'all']: [newCondition(firstRef, firstRef?.key ?? '')] } as ShowIf))}
          >
            + Group
          </button>
        )}
      </div>
    </div>
  );
}

/** Editor for a question's show_if. Emits null for "always show". */
export function ShowIfEditor({ value, refs, onChange }: { value: ShowIf | null; refs: RefQuestion[]; onChange: (s: ShowIf | null) => void }) {
  if (!value) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-stone-600">Always shown.</span>
        {refs.length ? (
          <button type="button" className="btn-secondary px-3 py-1 text-sm" onClick={() => onChange({ all: [newCondition(refs[0], refs[0].key)] })}>
            Only show when…
          </button>
        ) : (
          <span className="text-stone-400">(Conditions can only use questions above this one.)</span>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <GroupEditor root={value} path={[]} refs={refs} onChange={(s) => onChange(groupItems(s).length ? s : null)} />
      <div className="flex gap-3 text-xs">
        <button type="button" className="text-stone-500 underline" onClick={() => onChange(pruneShowIf(value))}>
          Tidy empty groups
        </button>
        <button type="button" className="text-red-600 underline" onClick={() => onChange(null)}>
          Always show (remove conditions)
        </button>
      </div>
    </div>
  );
}
