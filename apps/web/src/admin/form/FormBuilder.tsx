// Question builder: drag-and-drop order, inline validation on every change, safe removal,
// type changes, publish and versions.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { format } from 'date-fns';
import { classifyKindChange } from '@shared/edit-safety.ts';
import type { QuestionKind } from '@shared/types.ts';
import { PATH_KEY } from '@shared/types.ts';
import { defaultModes, describeModes, normalizeConfig } from '@shared/input-modes.ts';
import { hasErrors, type Issue, KEY_RE, MAX_SCREENS, screensPerPath, validateDraft } from '@shared/validator.ts';
import { errMsg, must, qk, rpc, supabase } from '../api.ts';
import { useAdmin } from '../context.tsx';
import type { FormVersionRow, OptionRow, QuestionRow } from '../types.ts';
import { Badge, ErrorBox, Modal, Sheet, Spinner, useConfirm, useToast } from '../ui.tsx';
import { useAutosave } from './autosave.ts';
import { describeShowIf } from './conditionValue.ts';
import { QuestionEditor } from './QuestionEditor.tsx';
import { KIND_LABEL } from './modes.ts';
import { toDraft, toRef } from './draft.ts';
import { planRemoval } from './removal.ts';
import { loadProfileRefs } from './profileRefs.ts';
import { uniqueSlug } from './removal.ts';

const byPos = (a: QuestionRow, b: QuestionRow) => a.position - b.position || a.created_at.localeCompare(b.created_at);

export { toDraft, toRef };

const modesLabel = (q: { kind: QuestionKind; input_modes: QuestionRow['input_modes'] }) => describeModes(q.input_modes, q.kind);

export default function FormBuilder() {
  const { property } = useAdmin();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const saver = useAutosave();
  const pid = property.id;

  const questionsQ = useQuery({
    queryKey: qk.questions(pid),
    queryFn: async () => {
      const rows = must(await supabase.from('questions').select('*, question_options(*)').eq('property_id', pid).order('position').order('created_at')) as QuestionRow[];
      return rows.map((r) => ({ ...r, validation: r.validation ?? {}, question_options: [...r.question_options].sort((a, b) => a.position - b.position) }));
    },
  });
  const [rows, setRows] = useState<QuestionRow[] | null>(null);
  useEffect(() => {
    if (questionsQ.data && !saver.hasPending()) setRows(questionsQ.data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questionsQ.data]);

  const reload = useCallback(async () => {
    await saver.flush();
    const r = await questionsQ.refetch();
    if (r.data) setRows(r.data);
  }, [saver, questionsQ]);

  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [kindDialog, setKindDialog] = useState<{ q: QuestionRow; to: QuestionKind } | null>(null);
  const [showVersions, setShowVersions] = useState(false);

  const all = useMemo(() => [...(rows ?? [])].sort(byPos), [rows]);
  const active = useMemo(() => all.filter((q) => !q.archived_at), [all]);
  const archived = useMemo(() => all.filter((q) => q.archived_at), [all]);
  const drafts = useMemo(() => all.map(toDraft), [all]);
  const issues = useMemo(() => validateDraft(drafts), [drafts]);
  const screens = useMemo(() => screensPerPath(drafts), [drafts]);
  const takenKeys = useMemo(() => new Set(all.map((q) => q.key)), [all]);
  const issuesFor = (key: string) => issues.filter((i) => i.question_key === key);
  const generalIssues = issues.filter((i) => !i.question_key || !active.some((q) => q.key === i.question_key));
  const blocked = hasErrors(issues);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  if (questionsQ.isLoading || !rows) return questionsQ.error ? <ErrorBox error={questionsQ.error} onRetry={() => questionsQ.refetch()} /> : <Spinner />;

  // ---------------------------------------------------------------- local edits
  const updateQ = (id: string, patch: Partial<QuestionRow>) => setRows((rs) => rs!.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const patchQuestion = (q: QuestionRow, patch: Partial<QuestionRow>) => {
    updateQ(q.id, patch);
    saver.queue('questions', q.id, patch as Record<string, unknown>);
  };
  const patchOption = (o: OptionRow, patch: Partial<OptionRow>) => {
    setRows((rs) => rs!.map((r) => (r.id === o.question_id ? { ...r, question_options: r.question_options.map((x) => (x.id === o.id ? { ...x, ...patch } : x)) } : r)));
    saver.queue('question_options', o.id, patch as Record<string, unknown>);
  };

  async function run<T>(label: string, fn: () => Promise<T>, okMsg?: string | ((r: T) => string)): Promise<T | undefined> {
    setBusy(label);
    try {
      await saver.flush();
      const r = await fn();
      if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg, 'success');
      return r;
    } catch (e) {
      toast(errMsg(e instanceof Error ? e.message : e), 'error');
      return undefined;
    } finally {
      setBusy(null);
    }
  }

  // ---------------------------------------------------------------- order
  async function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const ids = active.map((q) => q.id);
    const next = arrayMove(ids, ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id)));
    setRows((rs) => rs!.map((r) => (next.includes(r.id) ? { ...r, position: next.indexOf(r.id) } : r)));
    await run('reorder', async () => {
      await rpc('reorder_questions', { p_property_id: pid, p_ids: next });
    });
  }

  async function moveQuestion(q: QuestionRow, dir: -1 | 1) {
    const ids = active.map((x) => x.id);
    const i = ids.indexOf(q.id);
    if (i + dir < 0 || i + dir >= ids.length) return;
    const next = arrayMove(ids, i, i + dir);
    setRows((rs) => rs!.map((r) => (next.includes(r.id) ? { ...r, position: next.indexOf(r.id) } : r)));
    await run('reorder', () => rpc('reorder_questions', { p_property_id: pid, p_ids: next }));
  }

  // ---------------------------------------------------------------- add
  async function addQuestion(kind: QuestionKind) {
    const key = uniqueSlug(kind === 'contact' ? 'contact' : kind === 'standard' ? 'new_question' : `new_${kind}`, takenKeys, { mustStartWithLetter: true, fallback: 'q' });
    const res = await run('add', async () => {
      const maxPos = Math.max(0, ...all.map((q) => q.position)) + 1;
      const inserted = must(
        await supabase
          .from('questions')
          .insert({ property_id: pid, key, kind, input_modes: kind === 'standard' ? defaultModes() : null, label_en: 'New question', position: maxPos, required: true })
          .select('id')
          .single(),
      ) as { id: string };
      if (kind === 'standard') {
        must(
          await supabase.from('question_options').insert([
            { question_id: inserted.id, value: 'option_1', label_en: 'Option 1', position: 0 },
            { question_id: inserted.id, value: 'option_2', label_en: 'Option 2', position: 1 },
          ]),
        );
      }
      // keep the contact question last
      const contact = active.find((q) => q.kind === 'contact');
      const order = [...active.filter((q) => q.id !== contact?.id).map((q) => q.id), inserted.id, ...(contact ? [contact.id] : [])];
      await rpc('reorder_questions', { p_property_id: pid, p_ids: order });
      return inserted.id;
    });
    if (res) {
      await reload();
      setOpenId(res);
    }
  }

  // ---------------------------------------------------------------- options
  async function addOption(q: QuestionRow, label: string) {
    const value = uniqueSlug(label, q.question_options.map((o) => o.value), { mustStartWithLetter: false, fallback: 'option' });
    const pos = Math.max(-1, ...q.question_options.map((o) => o.position)) + 1;
    const r = await run('option', async () => must(await supabase.from('question_options').insert({ question_id: q.id, value, label_en: label, position: pos }).select('*').single()) as OptionRow);
    if (r) setRows((rs) => rs!.map((x) => (x.id === q.id ? { ...x, question_options: [...x.question_options, r] } : x)));
  }
  async function reorderOptions(q: QuestionRow, next: string[]) {
    setRows((rs) => rs!.map((x) => (x.id === q.id ? { ...x, question_options: x.question_options.map((y) => (next.includes(y.id) ? { ...y, position: next.indexOf(y.id) } : y)) } : x)));
    await run('option', () => rpc('reorder_options', { p_question_id: q.id, p_ids: next }));
  }
  async function restoreOption(o: OptionRow) {
    const r = await run('option', async () => must(await supabase.from('question_options').update({ archived_at: null }).eq('id', o.id).select('id')), 'Option restored');
    if (r) await reload();
  }

  // ---------------------------------------------------------------- removal with dependencies
  async function remove(q: QuestionRow, o?: OptionRow) {
    await saver.flush();
    const target = { key: q.key, optionValue: o?.value };
    const what = o ? `the option “${o.label_en}” of “${q.label_en}”` : `“${q.label_en}”`;
    const verb = (o ? o.first_published_at : q.first_published_at) ? 'Archive' : 'Delete';
    const explain =
      verb === 'Archive'
        ? 'It has been published, so it will be archived: new respondents will not see it, and old answers keep it.'
        : 'It was never published, so it will be deleted permanently.';
    let refs;
    try {
      refs = await loadProfileRefs(pid);
    } catch (e) {
      toast(errMsg(e), 'error');
      return;
    }
    const planQs = active.map((x) => ({ id: x.id, key: x.key, label_en: x.label_en, show_if: x.show_if, archived_at: x.archived_at }));
    const draftPlan = planRemoval(target, planQs, refs.draftConditions, refs.draftNever);
    const liveOnly = !refs.draftId ? planRemoval(target, [], refs.currentConditions, refs.currentNever).dependencies : [];
    const deps = [...draftPlan.dependencies, ...liveOnly];
    if (deps.length === 0) {
      const ok = await confirm({ title: `${verb} ${o ? 'option' : 'question'}?`, body: <p>{`${verb} ${what}? ${explain}`}</p>, confirm: verb, danger: true });
      if (!ok) return;
    } else {
      const ok = await confirm({
        title: `${what} is still in use`,
        confirm: 'Remove from these too',
        danger: true,
        body: (
          <>
            <p>{explain}</p>
            <p>It is used by:</p>
            <ul className="list-disc pl-5">
              {deps.map((d) => (
                <li key={`${d.kind}-${d.id}`}>{d.label}</li>
              ))}
            </ul>
            {liveOnly.length > 0 && (
              <p className="rounded-lg bg-amber-50 p-2 text-amber-800">
                Your published Ideal Profiles use it. A new profiles draft will be created and the condition removed there; publish the draft on the Profiles page to apply it.
              </p>
            )}
            <p>“Remove from these too” removes it from every place listed (conditions that only used it are deleted), all at once.</p>
          </>
        ),
      });
      if (!ok) return;
    }
    const res = await run(
      'remove',
      async () => {
        let plan = draftPlan;
        if (liveOnly.length > 0) {
          await rpc('create_profile_draft', { p_property_id: pid });
          const fresh = await loadProfileRefs(pid);
          plan = planRemoval(target, planQs, fresh.draftConditions, fresh.draftNever);
        }
        // One transaction: show-if rewrites, condition/never-rule rewrites and deletions, then archive/delete.
        return rpc<string>('remove_question_or_option', {
          p_question_id: q.id,
          p_option_id: o?.id ?? null,
          p_show_if_updates: plan.showIfUpdates,
          p_remove_condition_ids: plan.removeConditionIds,
          p_remove_never_ids: plan.removeNeverIds,
          p_condition_updates: Object.fromEntries(plan.conditionUpdates.map((u) => [u.id, u.value])),
          p_never_updates: Object.fromEntries(plan.neverUpdates.map((u) => [u.id, u.value])),
        });
      },
      (r) => (r === 'archived' ? 'Archived' : 'Deleted'),
    );
    if (res) {
      qc.invalidateQueries({ queryKey: ['profiles'] });
      qc.invalidateQueries({ queryKey: ['never'] });
      qc.invalidateQueries({ queryKey: ['profile-sets'] });
    }
    await reload();
  }

  // ---------------------------------------------------------------- kind change
  async function changeKind(q: QuestionRow, to: QuestionKind) {
    if (classifyKindChange(q.kind, to) === 'same') return;
    if (q.first_published_at) {
      setKindDialog({ q, to });
      return;
    }
    // never published: change in place (modes travel together with the kind)
    patchQuestion(q, { kind: to, input_modes: to === 'standard' ? (q.input_modes ?? defaultModes()) : null, validation: {} });
    if (to === 'standard' && q.question_options.filter((o) => !o.archived_at).length < 2) {
      await saver.flush();
      for (let i = q.question_options.filter((o) => !o.archived_at).length; i < 2; i++) await addOption(q, `Option ${i + 1}`);
    }
  }

  async function restoreQuestion(q: QuestionRow) {
    const r = await run('restore', async () => must(await supabase.from('questions').update({ archived_at: null }).eq('id', q.id).select('id')), 'Question restored');
    if (r) await reload();
  }

  async function publish() {
    const cur = must(await supabase.from('form_versions').select('version').eq('property_id', pid).eq('is_current', true).maybeSingle()) as { version: number } | null;
    const warn = issues.filter((i) => i.level === 'warning');
    const ok = await confirm({
      title: 'Publish the form?',
      confirm: 'Publish',
      body: (
        <>
          <p>New respondents will see this version immediately{cur ? ` (replacing v${cur.version})` : ''}. People already filling the form finish on the version they started.</p>
          <p>
            Screens per path — rent {screens.rent}, partner {screens.partner}, either {screens.either}.
          </p>
          {warn.map((w, i) => (
            <p key={i} className="text-amber-800">
              ℹ {w.message}
            </p>
          ))}
        </>
      ),
    });
    if (!ok) return;
    const r = await run('publish', () => rpc<{ version: number }>('publish_form', { p_property_id: pid }), (x) => `Published version ${x.version}`);
    if (r) {
      qc.invalidateQueries({ queryKey: qk.formVersions(pid) });
      await reload();
    }
  }

  const refsBefore = (q: QuestionRow) => {
    const i = active.findIndex((x) => x.id === q.id);
    return active.slice(0, Math.max(i, 0)).filter((x) => x.kind !== 'contact').map(toRef);
  };
  const allRefs = new Map(all.map((q) => [q.key, toRef(q)]));
  const openQ = openId ? all.find((q) => q.id === openId && !q.archived_at) ?? null : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold">Questions</h1>
        <a className="btn-ghost text-sm" href={`/f/${property.slug}`} target="_blank" rel="noreferrer">
          Open live form ↗
        </a>
        <button className="btn-secondary" onClick={() => setShowVersions(true)}>
          Versions
        </button>
        <button className="btn-primary" disabled={blocked || !!busy} onClick={publish} title={blocked ? 'Fix the problems listed first' : undefined}>
          {busy === 'publish' ? 'Publishing…' : 'Publish'}
        </button>
      </div>

      <div className={`card p-3 text-sm ${blocked ? 'border-red-300' : ''}`}>
        <div className="flex flex-wrap items-center gap-3">
          <span className={blocked ? 'font-medium text-red-700' : 'font-medium text-emerald-700'}>
            {blocked ? `${issues.filter((i) => i.level === 'error').length} problem(s) to fix before publishing` : 'Ready to publish'}
          </span>
          <span className="text-stone-500">Screens:</span>
          {(['rent', 'partner', 'either'] as const).map((p) => (
            <Badge key={p} tone={screens[p] > MAX_SCREENS ? 'amber' : 'stone'}>
              {p} {screens[p]}
            </Badge>
          ))}
          <span className="ml-auto">{saver.busy ? 'Saving…' : saver.anyError ? <span className="text-red-700">Some changes are not saved</span> : 'All changes saved'}</span>
        </div>
        {generalIssues.length > 0 && <IssueList issues={generalIssues} />}
        <p className="mt-2 text-xs text-stone-500">Edits are saved as a draft automatically. Respondents only see them after you publish.</p>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={active.map((q) => q.id)} strategy={verticalListSortingStrategy}>
          <ol className="space-y-2">
            {active.map((q, i) => (
              <SortableQuestion
                key={q.id}
                modes={modesLabel(q)}
                q={q}
                index={i}
                count={active.length}
                onOpen={() => setOpenId(q.id)}
                onMove={(d) => moveQuestion(q, d)}
                issues={issuesFor(q.key)}
                summary={describeShowIf(q.show_if, allRefs)}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>

      <AddQuestion onAdd={addQuestion} disabled={!!busy} />

      {openQ && (
        <Sheet
          title={openQ.label_en || 'Untitled question'}
          onClose={() => {
            void saver.flush();
            setOpenId(null);
          }}
          actions={<span className="text-xs text-stone-500">{saver.busy ? 'Saving…' : saver.anyError ? 'Not saved' : 'Saved'}</span>}
        >
          <QuestionEditor
            q={openQ}
            earlier={refsBefore(openQ)}
            issues={issuesFor(openQ.key)}
            status={saver.statusOf('questions', openQ.id)}
            optionStatus={(id) => saver.statusOf('question_options', id)}
            takenKeys={new Set([...takenKeys].filter((k) => k !== openQ.key))}
            brandName={property.brand_name}
            onPatch={(patch) => patchQuestion(openQ, patch)}
            onRetry={() => void saver.flush()}
            onUndo={async () => {
              saver.discard('questions', openQ.id);
              await reload();
            }}
            onKindChange={(k) => void changeKind(openQ, k)}
            onRemove={async () => {
              await remove(openQ);
              setOpenId((x) => (all.some((q) => q.id === x && !q.archived_at) ? x : null));
            }}
            onOptionPatch={patchOption}
            onAddOption={(label) => addOption(openQ, label)}
            onReorderOptions={(ids) => reorderOptions(openQ, ids)}
            onRemoveOption={(o) => remove(openQ, o)}
            onRestoreOption={restoreOption}
          />
        </Sheet>
      )}

      {archived.length > 0 && (
        <details className="card p-3">
          <summary className="cursor-pointer font-medium">Archived questions ({archived.length})</summary>
          <p className="mt-1 text-sm text-stone-500">Hidden from new respondents. Old answers still show them. Their keys stay reserved.</p>
          <ul className="mt-2 divide-y divide-stone-100">
            {archived.map((q) => (
              <li key={q.id} className="flex items-center gap-2 py-2 text-sm">
                <span className="flex-1">
                  {q.label_en} <code className="text-xs text-stone-500">{q.key}</code> · {modesLabel(q)}
                </span>
                {q.key !== PATH_KEY && (
                  <button className="btn-secondary px-3 py-1 text-sm" onClick={() => restoreQuestion(q)}>
                    Restore
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {kindDialog && (
        <KindChangeDialog
          q={kindDialog.q}
          to={kindDialog.to}
          taken={takenKeys}
          onClose={() => setKindDialog(null)}
          onConfirm={async (newKey) => {
            const r = await run('kind', () => rpc<string>('replace_question_kind', { p_question_id: kindDialog.q.id, p_new_kind: kindDialog.to, p_new_key: newKey }), 'Kind changed — a new question replaced the old one');
            if (r) {
              setKindDialog(null);
              qc.invalidateQueries({ queryKey: ['profiles'] });
              qc.invalidateQueries({ queryKey: ['profile-sets'] });
              await reload();
              setOpenId(r);
            }
          }}
        />
      )}
      {showVersions && <VersionsDialog onClose={() => setShowVersions(false)} />}
    </div>
  );
}

function IssueList({ issues }: { issues: Issue[] }) {
  return (
    <ul className="mt-2 space-y-1">
      {issues.map((i, n) => (
        <li key={n} className={i.level === 'error' ? 'text-red-800' : 'text-amber-800'}>
          {i.level === 'error' ? '⚠ ' : 'ℹ '}
          {i.message}
        </li>
      ))}
    </ul>
  );
}

function SortableQuestion({
  q,
  modes,
  index,
  count,
  onOpen,
  onMove,
  issues,
  summary,
}: {
  q: QuestionRow;
  modes: string;
  index: number;
  count: number;
  onOpen: () => void;
  onMove: (d: -1 | 1) => void;
  issues: Issue[];
  summary: string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: q.id, disabled: q.key === PATH_KEY });
  const style = { transform: transform ? `translate3d(0, ${transform.y}px, 0)` : undefined, transition };
  const errors = issues.filter((i) => i.level === 'error').length;
  return (
    <li ref={setNodeRef} style={style} className={`card ${isDragging ? 'z-10 shadow-lg' : ''} ${errors ? 'border-red-300' : ''}`}>
      <div className="flex items-start gap-2 p-3">
        <button
          className="mt-0.5 cursor-grab touch-none px-1 text-stone-400 disabled:cursor-not-allowed disabled:opacity-30"
          aria-label={`Drag to reorder “${q.label_en}”`}
          disabled={q.key === PATH_KEY}
          {...attributes}
          {...listeners}
        >
          ⠿
        </button>
        <button className="min-w-0 flex-1 text-left" onClick={onOpen} aria-haspopup="dialog">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-stone-400">{index + 1}</span>
            <span className="font-medium">{q.label_en || <em className="text-stone-400">untitled</em>}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1 text-xs">
            <Badge>{modes}</Badge>
            <code className="text-stone-500">{q.key}</code>
            {q.required && <Badge>required</Badge>}
            {q.show_if && <Badge tone="blue" title={summary}>conditional</Badge>}
            {!q.first_published_at && <Badge tone="violet">not published yet</Badge>}
            {errors > 0 && <Badge tone="red">{errors} problem(s)</Badge>}
          </div>
          {q.show_if && <p className="mt-1 truncate text-xs text-stone-500">Shown if {summary}</p>}
        </button>
        <div className="flex flex-col">
          <button className="px-1 text-xs text-stone-500 disabled:opacity-30" disabled={index === 0 || q.key === PATH_KEY} onClick={() => onMove(-1)} aria-label="Move up">
            ▲
          </button>
          <button className="px-1 text-xs text-stone-500 disabled:opacity-30" disabled={index === count - 1 || q.key === PATH_KEY} onClick={() => onMove(1)} aria-label="Move down">
            ▼
          </button>
        </div>
      </div>
    </li>
  );
}

function AddQuestion({ onAdd, disabled }: { onAdd: (k: QuestionKind) => void; disabled: boolean }) {
  const [k, setK] = useState<QuestionKind>('standard');
  return (
    <div className="card flex flex-wrap items-center gap-2 p-3">
      <label className="text-sm font-medium" htmlFor="add-kind">
        Add a question:
      </label>
      <select id="add-kind" className="input w-auto" value={k} onChange={(e) => setK(e.target.value as QuestionKind)}>
        {(Object.keys(KIND_LABEL) as QuestionKind[]).map((x) => (
          <option key={x} value={x}>
            {KIND_LABEL[x]}
          </option>
        ))}
      </select>
      <button className="btn-primary" disabled={disabled} onClick={() => onAdd(k)}>
        + Add
      </button>
      <span className="text-xs text-stone-500">New questions go just above the contact question. Choose, Type and Speak are set inside the question.</span>
    </div>
  );
}

function KindChangeDialog({ q, to, taken, onClose, onConfirm }: { q: QuestionRow; to: QuestionKind; taken: Set<string>; onClose: () => void; onConfirm: (key: string) => void }) {
  const [key, setKey] = useState(() => uniqueSlug(`${q.key}_${to}`, taken, { mustStartWithLetter: true, fallback: 'q' }));
  const err = !KEY_RE.test(key) ? 'Use lowercase letters, numbers and _ (start with a letter).' : taken.has(key) ? 'This key is already used.' : null;
  return (
    <Modal title={`Change “${q.label_en}” to ${KIND_LABEL[to]}?`} onClose={onClose}>
      <div className="space-y-3 text-sm text-stone-700">
        <p>
          This question has been published as <b>{KIND_LABEL[q.kind]}</b>. Answers already collected have that shape, so it cannot be converted in place.
        </p>
        <p className="text-stone-500">(Switching Choose / Type / Speak on or off, the choose style or character limits never needs this — those are changed in place.)</p>
        <p>Instead we will:</p>
        <ul className="list-disc pl-5">
          <li>archive the old question (old leads keep their answers),</li>
          <li>create a new {KIND_LABEL[to]} question with the same text and a new key,</li>
          <li>point every “when to show” condition and your draft Ideal Profile conditions at the new question.</li>
        </ul>
        <p className="rounded-lg bg-amber-50 p-2 text-amber-800">
          Review those conditions afterwards — a comparison that made sense before may not now (they will be flagged). Then publish the form and the profiles draft.
        </p>
        <div>
          <label className="label" htmlFor="newkey">
            New key
          </label>
          <input id="newkey" className="input font-mono" value={key} maxLength={40} onChange={(e) => setKey(e.target.value.toLowerCase())} />
          {err && <p className="mt-1 text-xs text-red-700">{err}</p>}
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button className="btn-primary" disabled={!!err} onClick={() => onConfirm(key)}>
          Change kind
        </button>
      </div>
    </Modal>
  );
}

function VersionsDialog({ onClose }: { onClose: () => void }) {
  const { property } = useAdmin();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [view, setView] = useState<FormVersionRow | null>(null);
  const versions = useQuery({
    queryKey: qk.formVersions(property.id),
    queryFn: async () => must(await supabase.from('form_versions').select('*').eq('property_id', property.id).order('version', { ascending: false })) as FormVersionRow[],
  });
  const admins = useQuery({
    queryKey: ['admin-emails'],
    queryFn: async () => must(await supabase.from('admins').select('user_id, email')) as { user_id: string; email: string }[],
  });
  async function restore(v: FormVersionRow) {
    const ok = await confirm({
      title: `Make version ${v.version} live again?`,
      confirm: 'Restore',
      body: <p>Respondents will see version {v.version} again (saved as a new version number). Your draft questions are not changed.</p>,
    });
    if (!ok) return;
    try {
      const r = await rpc<{ version: number }>('restore_form_version', { p_version_id: v.id });
      toast(`Version ${v.version} is live again (as v${r.version})`, 'success');
      qc.invalidateQueries({ queryKey: qk.formVersions(property.id) });
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }
  return (
    <Modal title="Published versions" onClose={onClose} wide>
      {versions.isLoading ? (
        <Spinner />
      ) : !versions.data?.length ? (
        <p className="text-sm text-stone-500">Nothing published yet.</p>
      ) : (
        <ul className="divide-y divide-stone-100 text-sm">
          {versions.data.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center gap-2 py-2">
              <span className="font-medium">v{v.version}</span>
              {v.is_current && <Badge tone="green">live</Badge>}
              <span className="text-stone-500">
                {format(new Date(v.published_at), 'd MMM yyyy, HH:mm')} · {admins.data?.find((a) => a.user_id === v.published_by)?.email ?? 'system'} · {v.config.questions.length} questions
              </span>
              <span className="ml-auto flex gap-2">
                <button className="btn-ghost px-2 py-1" onClick={() => setView(view?.id === v.id ? null : v)}>
                  {view?.id === v.id ? 'Hide' : 'View'}
                </button>
                {!v.is_current && (
                  <button className="btn-secondary px-2 py-1" onClick={() => restore(v)}>
                    Restore
                  </button>
                )}
              </span>
              {view?.id === v.id && (
                <ol className="w-full list-decimal space-y-1 pl-6 text-stone-700">
                  {normalizeConfig(v.config).questions.map((q) => (
                    <li key={q.key}>
                      {q.label_en} <span className="text-xs text-stone-500">({describeModes(q.input_modes, q.kind)}{q.show_if ? ', conditional' : ''})</span>
                    </li>
                  ))}
                </ol>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
