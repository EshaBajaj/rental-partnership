// Ideal Profiles builder: draft editing with live counters, simulate, publish, roll back.
import { isSingleSelect } from '@shared/input-modes.ts';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { closestCenter, DndContext, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { format } from 'date-fns';
import type { Cond, Importance, ProfileSetSettings } from '@shared/types.ts';
import { DEFAULT_PROFILE_SETTINGS } from '@shared/types.ts';
import { checkCondition } from '@shared/validator.ts';
import { errMsg, must, qk, rpc, supabase } from '../api.ts';
import { useAdmin } from '../context.tsx';
import type { LiveCount, NeverRuleRow, ProfileConditionRow, ProfileRow, ProfileSetRow, QuestionRow, SimulateResult } from '../types.ts';
import { Badge, Empty, ErrorBox, SaveIndicator, Spinner, TIER_LABEL, useConfirm, useDebounced, useToast } from '../ui.tsx';
import { useAutosave } from '../form/autosave.ts';
import { ConditionRow } from '../form/ConditionEditor.tsx';
import { describeCondition, newCondition, type RefQuestion } from '../form/conditionValue.ts';
import { toRef } from '../form/draft.ts';
import { ReorderHint, rowListeners } from '../form/reorder.tsx';
import { buzzOnPickUp, liftedClass, useHoldToReorderSensors } from '../sortable.ts';
import { Icon } from '../../lib/icons.tsx';
import { mergeSettings } from './settings.ts';

const IMPORTANCE_LABEL: Record<Importance, string> = { must: 'Must have', important: 'Important', nice: 'Nice to have' };
const IMPORTANCE_TONE: Record<Importance, 'red' | 'amber' | 'stone'> = { must: 'red', important: 'amber', nice: 'stone' };

export default function Profiles() {
  const { property } = useAdmin();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const pid = property.id;
  const sets = useQuery({
    queryKey: qk.profileSets(pid),
    queryFn: async () => must(await supabase.from('profile_sets').select('*').eq('property_id', pid).order('version', { ascending: false })) as ProfileSetRow[],
  });
  const questions = useQuery({
    queryKey: qk.questions(pid),
    queryFn: async () => {
      const rows = must(await supabase.from('questions').select('*, question_options(*)').eq('property_id', pid).order('position').order('created_at')) as QuestionRow[];
      return rows.map((r) => ({ ...r, validation: r.validation ?? {}, question_options: [...r.question_options].sort((a, b) => a.position - b.position) }));
    },
  });
  const [busy, setBusy] = useState(false);

  if (sets.isLoading || questions.isLoading) return <Spinner />;
  if (sets.error || questions.error) return <ErrorBox error={sets.error ?? questions.error} onRetry={() => (sets.refetch(), questions.refetch())} />;
  const draft = sets.data!.find((s) => s.status === 'draft') ?? null;
  const current = sets.data!.find((s) => s.is_current) ?? null;
  const published = sets.data!.filter((s) => s.status === 'published');
  const qrows = questions.data!.filter((q) => q.kind !== 'contact');
  const refs = qrows.filter((q) => !q.archived_at).map(toRef).concat(qrows.filter((q) => q.archived_at).map(toRef));

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: qk.profileSets(pid) });
    qc.invalidateQueries({ queryKey: ['profiles'] });
    qc.invalidateQueries({ queryKey: ['never'] });
    qc.invalidateQueries({ queryKey: ['leads'] });
    qc.invalidateQueries({ queryKey: ['lead'] });
  };

  async function createDraft() {
    setBusy(true);
    try {
      await rpc('create_profile_draft', { p_property_id: pid });
      invalidate();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function rollback(s: ProfileSetRow) {
    let sim: SimulateResult | null = null;
    try {
      sim = await rpc<SimulateResult>('simulate_profile_set', { p_set_id: s.id });
    } catch (e) {
      toast(errMsg(e), 'error');
    }
    const ok = await confirm({
      title: `Roll back to profiles v${s.version}?`,
      confirm: 'Roll back',
      danger: true,
      body: (
        <>
          <p>Every lead will be re-ranked with version {s.version}. Each tier change is recorded on the lead’s timeline.</p>
          {sim && <SimSummary sim={sim} />}
        </>
      ),
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await rpc<{ tier_changes: number; responses: number }>('publish_profile_set', { p_set_id: s.id });
      toast(`Rolled back. ${r.tier_changes} of ${r.responses} leads changed tier.`, 'success');
      invalidate();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="page-title mr-auto">Ideal Profiles</h1>
        {current && <Badge tone="green">Live: v{current.version}</Badge>}
        {draft && <Badge tone="amber">Draft: v{draft.version}</Badge>}
      </div>
      <p className="text-sm text-stone-600">
        A profile is a combination of answers you would love to see. Every lead is compared with every active profile: <b>must have</b> conditions decide whether
        a lead qualifies; <b>important</b> (weight {mergeSettings(draft?.settings ?? current?.settings).weights.important}) and <b>nice to have</b> (weight{' '}
        {mergeSettings(draft?.settings ?? current?.settings).weights.nice}) conditions make up the match %. Conditions about questions a person never saw are ignored.
      </p>

      {draft ? (
        <DraftEditor key={draft.id} draft={draft} refs={refs} qrows={qrows} onChanged={invalidate} />
      ) : (
        <div className="space-y-3">
          <div className="card flex flex-wrap items-center gap-3 p-4">
            <p className="min-w-[12rem] flex-1 text-sm text-stone-700">
              {current ? 'Published profiles cannot be edited directly. Start a draft (a copy of the live version), change it, check the effect, then publish.' : 'No profiles yet. Create a draft to define your ideal tenants and partners.'}
            </p>
            <button className="btn-primary" disabled={busy} onClick={createDraft}>
              {current ? 'Edit (create draft)' : 'Create first draft'}
            </button>
          </div>
          {current && <SetView setId={current.id} refs={refs} />}
        </div>
      )}

      <section className="card p-4">
        <h2 className="font-semibold text-stone-900">Published versions</h2>
        {!published.length ? (
          <p className="text-sm text-stone-500">None yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-stone-100 text-sm">
            {published.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="font-medium">v{s.version}</span>
                {s.is_current && <Badge tone="green">live</Badge>}
                <span className="text-stone-500">{s.published_at ? format(new Date(s.published_at), 'd MMM yyyy, HH:mm') : ''}</span>
                {!s.is_current && (
                  <button className="btn-secondary btn-sm ml-auto" disabled={busy} onClick={() => rollback(s)}>
                    Roll back to this
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- read-only view
function SetView({ setId, refs }: { setId: string; refs: RefQuestion[] }) {
  const profiles = useQuery({
    queryKey: qk.profiles(setId),
    queryFn: async () => must(await supabase.from('profiles').select('*, profile_conditions(*)').eq('profile_set_id', setId).order('position')) as ProfileRow[],
  });
  const never = useQuery({
    queryKey: qk.never(setId),
    queryFn: async () => must(await supabase.from('never_rules').select('*').eq('profile_set_id', setId)) as NeverRuleRow[],
  });
  const refMap = new Map(refs.map((r) => [r.key, r]));
  if (profiles.isLoading) return <Spinner />;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {(profiles.data ?? []).map((p) => (
        <div key={p.id} className={`card p-4 ${p.active ? '' : 'opacity-60'}`}>
          <h3 className="font-semibold">
            {p.name} {!p.active && <Badge>inactive</Badge>}
          </h3>
          {p.description && <p className="text-sm text-stone-600">{p.description}</p>}
          <ul className="mt-2 space-y-1 text-sm">
            {[...p.profile_conditions]
              .sort((a, b) => a.position - b.position)
              .map((c) => (
                <li key={c.id}>
                  <Badge tone={IMPORTANCE_TONE[c.importance]}>{IMPORTANCE_LABEL[c.importance]}</Badge>{' '}
                  {describeCondition({ q: c.question_key, op: c.operator, v: c.value }, refMap.get(c.question_key))}
                </li>
              ))}
          </ul>
        </div>
      ))}
      {(never.data ?? []).length > 0 && (
        <div className="card p-4 md:col-span-2">
          <h3 className="font-semibold">Never rules</h3>
          <ul className="mt-1 space-y-1 text-sm">
            {never.data!.map((n) => (
              <li key={n.id} className="flex gap-2">
                <Icon name="blocked" size={16} className="mt-0.5 text-red-700" />
                <span className="min-w-0">
                  {n.label}: {describeCondition({ q: n.question_key, op: n.operator, v: n.value }, refMap.get(n.question_key))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- draft editor
function condErrors(c: { question_key: string; operator: ProfileConditionRow['operator']; value: unknown }, qrows: QuestionRow[], where: string): string[] {
  const ref = qrows.find((q) => q.key === c.question_key);
  return checkCondition(
    { q: c.question_key, op: c.operator, v: c.value } as Cond,
    ref ? { ...ref, options: ref.question_options.map((o) => ({ ...o })) } : undefined,
    where,
  );
}

function DraftEditor({ draft, refs, qrows, onChanged }: { draft: ProfileSetRow; refs: RefQuestion[]; qrows: QuestionRow[]; onChanged: () => void }) {
  const { property } = useAdmin();
  const toast = useToast();
  const confirm = useConfirm();
  const saver = useAutosave(600);
  const profilesQ = useQuery({
    queryKey: qk.profiles(draft.id),
    queryFn: async () => {
      const ps = must(await supabase.from('profiles').select('*, profile_conditions(*)').eq('profile_set_id', draft.id).order('position').order('created_at')) as ProfileRow[];
      return ps.map((p) => ({ ...p, profile_conditions: [...p.profile_conditions].sort((a, b) => a.position - b.position) }));
    },
  });
  const neverQ = useQuery({
    queryKey: qk.never(draft.id),
    queryFn: async () => must(await supabase.from('never_rules').select('*').eq('profile_set_id', draft.id).order('label')) as NeverRuleRow[],
  });
  const [profiles, setProfiles] = useState<ProfileRow[] | null>(null);
  const [never, setNever] = useState<NeverRuleRow[] | null>(null);
  const [settings, setSettings] = useState<ProfileSetSettings>(() => mergeSettings(draft.settings));
  const [sim, setSim] = useState<SimulateResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const sensors = useHoldToReorderSensors();
  useEffect(() => {
    if (profilesQ.data && !saver.hasPending()) setProfiles(profilesQ.data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profilesQ.data]);
  useEffect(() => {
    if (neverQ.data && !saver.hasPending()) setNever(neverQ.data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [neverQ.data]);

  const allErrors = useMemo(() => {
    const out: string[] = [];
    for (const p of profiles ?? []) {
      if (!p.name.trim()) out.push('A profile has no name.');
      if (p.active && p.profile_conditions.length === 0) out.push(`Profile “${p.name}” has no conditions.`);
      for (const c of p.profile_conditions) out.push(...condErrors(c, qrows, `Profile “${p.name}”`));
    }
    for (const n of never ?? []) {
      if (!n.label.trim()) out.push('A never rule has no label.');
      out.push(...condErrors(n, qrows, `Never rule “${n.label}”`));
    }
    if (settings.thresholds.maybe > settings.thresholds.ideal) out.push('The “Maybe” threshold is higher than the “Ideal” threshold.');
    return out;
  }, [profiles, never, settings, qrows]);

  if (!profiles || !never) return profilesQ.error || neverQ.error ? <ErrorBox error={profilesQ.error ?? neverQ.error} /> : <Spinner />;

  const reload = async () => {
    await saver.flush();
    const [a, b] = await Promise.all([profilesQ.refetch(), neverQ.refetch()]);
    if (a.data) setProfiles(a.data);
    if (b.data) setNever(b.data);
  };
  async function act<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(label);
    try {
      await saver.flush();
      return await fn();
    } catch (e) {
      toast(errMsg(e instanceof Error ? e.message : e), 'error');
      return undefined;
    } finally {
      setBusy(null);
    }
  }

  // ---- profile edits
  const patchProfile = (p: ProfileRow, patch: Partial<ProfileRow>) => {
    setProfiles((ps) => ps!.map((x) => (x.id === p.id ? { ...x, ...patch } : x)));
    saver.queue('profiles', p.id, patch as Record<string, unknown>);
  };
  const patchCond = (p: ProfileRow, c: ProfileConditionRow, patch: Partial<ProfileConditionRow>) => {
    setProfiles((ps) => ps!.map((x) => (x.id === p.id ? { ...x, profile_conditions: x.profile_conditions.map((y) => (y.id === c.id ? { ...y, ...patch } : y)) } : x)));
    saver.queue('profile_conditions', c.id, patch as Record<string, unknown>);
  };
  const patchNever = (n: NeverRuleRow, patch: Partial<NeverRuleRow>) => {
    setNever((ns) => ns!.map((x) => (x.id === n.id ? { ...x, ...patch } : x)));
    saver.queue('never_rules', n.id, patch as Record<string, unknown>);
  };
  const saveSettings = (s: ProfileSetSettings) => {
    setSettings(s);
    saver.queue('profile_sets', draft.id, { settings: s });
  };

  const firstRef = refs.find((r) => !r.archived);
  async function addProfile() {
    await act('add', async () => {
      must(await supabase.from('profiles').insert({ profile_set_id: draft.id, name: 'New profile', position: profiles!.length }).select('id').single());
      await reload();
    });
  }
  async function addCondition(p: ProfileRow) {
    if (!firstRef) return;
    const c = newCondition(firstRef, firstRef.key);
    await act('add', async () => {
      must(
        await supabase
          .from('profile_conditions')
          .insert({ profile_id: p.id, question_key: c.q, operator: c.op, value: c.v ?? null, importance: 'important', position: p.profile_conditions.length })
          .select('id')
          .single(),
      );
      await reload();
    });
  }
  async function deleteRow(table: 'profiles' | 'profile_conditions' | 'never_rules', id: string, what: string) {
    if (!(await confirm({ title: `Delete ${what}?`, body: <p>This only changes the draft.</p>, confirm: 'Delete', danger: true }))) return;
    await act('delete', async () => {
      saver.discard(table, id);
      must(await supabase.from(table).delete().eq('id', id).select('id'));
      await reload();
    });
  }
  /** Apply a new profile order: every profile whose position changed is saved through patchProfile (autosave queue). */
  function reorderProfiles(next: ProfileRow[]) {
    next.forEach((p, i) => {
      if (p.position !== i) patchProfile(p, { position: i });
    });
    setProfiles(next.map((p, i) => (p.position === i ? p : { ...p, position: i })));
  }
  async function moveProfile(i: number, dir: -1 | 1) {
    if (!profiles![i] || !profiles![i + dir]) return;
    reorderProfiles(arrayMove(profiles!, i, i + dir));
  }
  function onProfileDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const ids = profiles!.map((p) => p.id);
    const from = ids.indexOf(String(e.active.id));
    const to = ids.indexOf(String(e.over.id));
    if (from < 0 || to < 0) return;
    reorderProfiles(arrayMove(profiles!, from, to));
  }
  async function addNever() {
    if (!firstRef) return;
    const c = newCondition(firstRef, firstRef.key);
    await act('add', async () => {
      must(await supabase.from('never_rules').insert({ profile_set_id: draft.id, question_key: c.q, operator: c.op, value: c.v ?? null, label: 'New never rule' }).select('id').single());
      await reload();
    });
  }

  async function simulate() {
    const r = await act('simulate', () => rpc<SimulateResult>('simulate_profile_set', { p_set_id: draft.id }));
    if (r) setSim(r);
    return r;
  }
  async function publish() {
    const r = await simulate();
    if (!r) return;
    const ok = await confirm({
      title: `Publish profiles v${draft.version}?`,
      confirm: 'Publish and re-rank',
      body: (
        <>
          <p>All {r.total} leads are re-ranked in one go. Tier changes are recorded on each lead.</p>
          <SimSummary sim={r} />
        </>
      ),
    });
    if (!ok) return;
    const res = await act('publish', () => rpc<{ tier_changes: number; responses: number; version: number }>('publish_profile_set', { p_set_id: draft.id }));
    if (res) {
      toast(`Profiles v${res.version} are live. ${res.tier_changes} of ${res.responses} leads changed tier.`, 'success');
      onChanged();
    }
  }
  async function discard() {
    if (!(await confirm({ title: 'Discard this draft?', body: <p>All changes in the draft are lost. The live profiles stay as they are.</p>, confirm: 'Discard', danger: true }))) return;
    const r = await act('discard', () => rpc('discard_profile_draft', { p_set_id: draft.id }));
    if (r !== undefined) onChanged();
  }

  const statusLine = saver.busy ? 'Saving…' : saver.anyError ? 'Some changes are not saved' : 'Draft saved';

  return (
    <div className="space-y-4">
      <div className="card sticky top-14 z-20 flex flex-wrap items-center gap-2 p-3">
        <span className={`text-sm ${saver.anyError ? 'text-red-700' : 'text-stone-500'}`}>{statusLine}</span>
        {allErrors.length > 0 && (
          <span className="flex items-center gap-1 text-sm font-medium text-red-700">
            <Icon name="alert" size={16} />
            {allErrors.length} problem(s)
          </span>
        )}
        <div className="ml-auto flex flex-wrap justify-end gap-2">
          <button className="btn-ghost text-red-700 hover:bg-red-50" disabled={!!busy} onClick={discard}>
            Discard draft
          </button>
          <button className="btn-secondary" disabled={!!busy} onClick={simulate}>
            {busy === 'simulate' ? 'Simulating…' : 'Simulate'}
          </button>
          <button className="btn-primary" disabled={!!busy || allErrors.length > 0} onClick={publish}>
            {busy === 'publish' ? 'Publishing…' : 'Publish'}
          </button>
        </div>
        {allErrors.length > 0 && (
          <ul className="w-full space-y-0.5 text-xs text-red-700">
            {allErrors.slice(0, 8).map((m, i) => (
              <li key={i} className="flex gap-1.5">
                <Icon name="alert" size={14} className="mt-px" />
                <span className="min-w-0">{m}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {sim && (
        <div className="card p-4">
          <div className="flex items-center gap-2">
            <h2 className="mr-auto font-semibold text-stone-900">Simulation (nothing changed yet)</h2>
            <button className="btn-ghost btn-sm" onClick={() => setSim(null)}>
              Hide
            </button>
          </div>
          <SimSummary sim={sim} detailed />
        </div>
      )}

      {profiles.length === 0 && <Empty>No profiles in this draft yet.</Empty>}
      {profiles.length > 1 && <ReorderHint />}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={buzzOnPickUp} onDragEnd={onProfileDragEnd}>
        <SortableContext items={profiles.map((p) => p.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-4">
            {profiles.map((p, i) => (
              <SortableProfileCard key={p.id} id={p.id} name={p.name} className={`card space-y-3 p-3 sm:p-4 ${p.active ? '' : 'opacity-70'}`}>
                {(grip) => (
                  <>
                    <div className="flex flex-wrap items-center gap-1">
                      {grip}
                      <span className="text-xs font-medium uppercase tracking-wide text-stone-500">Profile {i + 1}</span>
                      <span className="ml-1">
                        <SaveIndicator {...saver.statusOf('profiles', p.id)} onRetry={() => void saver.flush()} />
                      </span>
                      <div className="ml-auto flex items-center gap-1">
                        <label className="flex min-h-10 cursor-pointer items-center gap-2 px-2 text-sm text-stone-700">
                          <input type="checkbox" className="h-4 w-4 accent-brand-700" checked={p.active} onChange={(e) => patchProfile(p, { active: e.target.checked })} /> Active
                        </label>
                        <button type="button" data-no-drag className="btn-ghost btn-icon btn-sm text-stone-500" disabled={i === 0} onClick={() => moveProfile(i, -1)} aria-label={`Move profile “${p.name}” up`}>
                          <Icon name="up" />
                        </button>
                        <button type="button" data-no-drag className="btn-ghost btn-icon btn-sm text-stone-500" disabled={i === profiles.length - 1} onClick={() => moveProfile(i, 1)} aria-label={`Move profile “${p.name}” down`}>
                          <Icon name="down" />
                        </button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="sr-only" htmlFor={`pn-${p.id}`}>
                        Profile name
                      </label>
                      <input id={`pn-${p.id}`} className="input text-lg font-semibold" maxLength={80} value={p.name} onChange={(e) => patchProfile(p, { name: e.target.value })} />
                      <label className="sr-only" htmlFor={`pd-${p.id}`}>
                        Description
                      </label>
                      <input id={`pd-${p.id}`} className="input text-sm" maxLength={500} placeholder="Description (optional)" value={p.description ?? ''} onChange={(e) => patchProfile(p, { description: e.target.value || null })} />
                    </div>
                    <LiveCounter propertyId={property.id} conditions={p.profile_conditions} />
                    <div className="space-y-2">
                      {p.profile_conditions.map((c) => (
                        <ConditionRow
                          key={c.id}
                          cond={{ q: c.question_key, op: c.operator, v: c.value }}
                          refs={refs}
                          error={condErrors(c, qrows, 'This condition')}
                          onChange={(n) => patchCond(p, c, { question_key: n.q, operator: n.op, value: n.v ?? null })}
                          onRemove={() => deleteRow('profile_conditions', c.id, 'this condition')}
                          extra={
                            <>
                              <label className="sr-only" htmlFor={`imp-${c.id}`}>
                                Importance
                              </label>
                              <select id={`imp-${c.id}`} className="input w-full sm:w-auto" value={c.importance} onChange={(e) => patchCond(p, c, { importance: e.target.value as Importance })}>
                                {(Object.keys(IMPORTANCE_LABEL) as Importance[]).map((k) => (
                                  <option key={k} value={k}>
                                    {IMPORTANCE_LABEL[k]}
                                  </option>
                                ))}
                              </select>
                              <SaveIndicator {...saver.statusOf('profile_conditions', c.id)} onRetry={() => void saver.flush()} />
                            </>
                          }
                        />
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className="btn-secondary" disabled={!!busy || !firstRef} onClick={() => addCondition(p)}>
                        <Icon name="add" />
                        Condition
                      </button>
                      <button type="button" className="btn-ghost ml-auto text-red-700 hover:bg-red-50" onClick={() => deleteRow('profiles', p.id, `profile “${p.name}”`)}>
                        <Icon name="delete" />
                        Delete profile
                      </button>
                    </div>
                  </>
                )}
              </SortableProfileCard>
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <button className="btn-secondary" disabled={!!busy} onClick={addProfile}>
        <Icon name="add" />
        Add profile
      </button>

      <section className="card space-y-3 p-3 sm:p-4">
        <h2 className="flex items-center gap-2 font-semibold text-stone-900">
          <Icon name="blocked" className="text-red-700" />
          Never rules
        </h2>
        <p className="text-sm text-stone-600">If any of these is true, the lead is “Not a fit” no matter how well it matches.</p>
        {never.map((n) => (
          <div key={n.id} className="space-y-2">
            <div className="flex items-center gap-2">
              <label className="sr-only" htmlFor={`nl-${n.id}`}>
                Label
              </label>
              <input id={`nl-${n.id}`} className="input min-w-0 flex-1" maxLength={120} value={n.label} onChange={(e) => patchNever(n, { label: e.target.value })} placeholder="Label shown on the lead" />
              <SaveIndicator {...saver.statusOf('never_rules', n.id)} onRetry={() => void saver.flush()} />
            </div>
            <ConditionRow
              cond={{ q: n.question_key, op: n.operator, v: n.value }}
              refs={refs}
              error={condErrors(n, qrows, 'This rule')}
              onChange={(c) => patchNever(n, { question_key: c.q, operator: c.op, value: c.v ?? null })}
              onRemove={() => deleteRow('never_rules', n.id, `never rule “${n.label}”`)}
            />
          </div>
        ))}
        <button className="btn-secondary" disabled={!!busy || !firstRef} onClick={addNever}>
          <Icon name="add" />
          Never rule
        </button>
      </section>

      <SettingsEditor settings={settings} onChange={saveSettings} qrows={qrows} status={saver.statusOf('profile_sets', draft.id)} onRetry={() => void saver.flush()} />
    </div>
  );
}

/** A profile card that can be picked up by pressing and holding anywhere outside its fields. */
function SortableProfileCard({ id, name, className, children }: { id: string; name: string; className: string; children: (grip: ReactNode) => ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  const grip = (
    <button
      ref={setActivatorNodeRef}
      type="button"
      className="btn-ghost btn-icon btn-sm cursor-grab text-stone-400"
      title="Hold to drag"
      {...attributes}
      aria-label={`Reorder profile “${name}”: hold to drag, or press Space and use the arrow keys`}
    >
      <Icon name="drag" />
    </button>
  );
  return (
    <section
      ref={setNodeRef}
      style={{ transform: transform ? `translate3d(0, ${transform.y}px, 0)` : undefined, transition }}
      className={`${className} ${isDragging ? liftedClass : ''}`}
      {...rowListeners(listeners)}
    >
      {children(grip)}
    </section>
  );
}

function LiveCounter({ propertyId, conditions }: { propertyId: string; conditions: ProfileConditionRow[] }) {
  const payload = useDebounced(
    JSON.stringify({ conditions: conditions.map((c) => ({ question_key: c.question_key, operator: c.operator, value: c.value, importance: c.importance })) }),
    500,
  );
  const q = useQuery({
    queryKey: ['live-count', propertyId, payload],
    queryFn: () => rpc<LiveCount>('live_profile_count', { p_property_id: propertyId, p_profile: JSON.parse(payload) }),
    staleTime: 10_000,
  });
  return (
    <p className="flex items-center gap-2 rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800" aria-live="polite">
      <Icon name="target" size={16} />
      {q.isLoading ? 'Counting…' : q.error ? 'Live count unavailable' : `${q.data!.qualified} of ${q.data!.total} current leads qualify · ${q.data!.ideal} would be Ideal`}
    </p>
  );
}

export function SimSummary({ sim, detailed }: { sim: SimulateResult; detailed?: boolean }) {
  return (
    <div className="space-y-2 text-sm">
      <table className="w-full max-w-sm text-left">
        <thead>
          <tr className="text-stone-500">
            <th className="font-normal">Tier</th>
            <th className="font-normal">Now</th>
            <th className="font-normal">After</th>
          </tr>
        </thead>
        <tbody>
          {(['ideal', 'maybe', 'no'] as const).map((t) => (
            <tr key={t}>
              <td>{TIER_LABEL[t]}</td>
              <td>{sim.old[t]}</td>
              <td className={sim.new[t] !== sim.old[t] ? 'font-semibold' : ''}>{sim.new[t]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        {sim.changed} of {sim.total} leads would change tier or best profile.
      </p>
      {detailed && sim.changes.length > 0 && (
        <ul className="max-h-72 divide-y divide-stone-100 overflow-y-auto">
          {sim.changes.map((c) => (
            <li key={c.response_id} className="py-1.5">
              <a className="font-medium hover:underline" href={`/admin/leads/${c.response_id}`}>
                {c.name}
              </a>
              : {TIER_LABEL[c.old_tier]} <Icon name="forward" size={14} className="inline align-[-2px]" label="becomes" /> <b>{TIER_LABEL[c.new_tier]}</b>
              {c.old_profile !== c.new_profile && (
                <span className="text-stone-500">
                  {' '}
                  ({c.old_profile ?? '—'} <Icon name="forward" size={12} className="inline align-[-1px]" label="becomes" /> {c.new_profile ?? '—'})
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NumIn({ label, value, onChange, step = 1, min, max }: { label: string; value: number; onChange: (n: number) => void; step?: number; min?: number; max?: number }) {
  const id = `s-${label.replace(/\W+/g, '-')}`;
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="number"
        className="input"
        step={step}
        min={min}
        max={max}
        value={Number.isFinite(value) ? value : ''}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (e.target.value !== '' && Number.isFinite(n)) onChange(n);
        }}
      />
    </div>
  );
}

function SettingsEditor({
  settings: s,
  onChange,
  qrows,
  status,
  onRetry,
}: {
  settings: ProfileSetSettings;
  onChange: (s: ProfileSetSettings) => void;
  qrows: QuestionRow[];
  status: { state: import('../ui.tsx').SaveState; error: string | null };
  onRetry: () => void;
}) {
  const [open, setOpen] = useState(false);
  const timingQ = qrows.find((q) => q.key === s.intent.timing_key);
  const set = (fn: (x: ProfileSetSettings) => void) => {
    const next = structuredClone(s);
    fn(next);
    onChange(next);
  };
  return (
    <section className="card p-3 sm:p-4">
      <div className="flex items-center gap-2">
        <button type="button" className="flex min-h-10 flex-1 items-center gap-2 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <Icon name="down" className={`text-stone-400 transition-transform ${open ? '' : '-rotate-90'}`} />
          <h2 className="font-semibold text-stone-900">Scoring settings</h2>
        </button>
        <SaveIndicator {...status} onRetry={onRetry} />
      </div>
      {open && (
        <div className="mt-3 space-y-4">
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <NumIn label="Weight: important" value={s.weights.important} min={0} onChange={(n) => set((x) => (x.weights.important = n))} />
            <NumIn label="Weight: nice to have" value={s.weights.nice} min={0} onChange={(n) => set((x) => (x.weights.nice = n))} />
            <NumIn label="Ideal at ≥ % match" value={s.thresholds.ideal} min={0} max={100} onChange={(n) => set((x) => (x.thresholds.ideal = n))} />
            <NumIn label="Maybe at ≥ % match" value={s.thresholds.maybe} min={0} max={100} onChange={(n) => set((x) => (x.thresholds.maybe = n))} />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <NumIn label="Priority: share of match (0–1)" value={s.priority.match} step={0.05} min={0} max={1} onChange={(n) => set((x) => (x.priority.match = n))} />
            <NumIn label="Priority: share of intent (0–1)" value={s.priority.intent} step={0.05} min={0} max={1} onChange={(n) => set((x) => (x.priority.intent = n))} />
          </div>
          <p className="text-xs text-stone-500">Priority = match share × best match % + intent share × intent score. Leads are sorted by tier, then priority.</p>
          <h3 className="font-medium">Intent score (0–100)</h3>
          <div>
            <label className="label" htmlFor="timing-q">
              “When do you want to start?” question
            </label>
            <select id="timing-q" className="input" value={s.intent.timing_key} onChange={(e) => set((x) => (x.intent.timing_key = e.target.value))}>
              {qrows
                .filter((q) => q.kind === 'standard' && !!q.input_modes?.choose.enabled && isSingleSelect(q.input_modes.choose))
                .map((q) => (
                  <option key={q.key} value={q.key}>
                    {q.label_en}
                  </option>
                ))}
            </select>
          </div>
          {timingQ && (
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
              {timingQ.question_options
                .filter((o) => !o.archived_at)
                .map((o) => (
                  <NumIn
                    key={o.value}
                    label={`Points: ${o.label_en}`}
                    value={s.intent.timing_points[o.value] ?? 0}
                    min={0}
                    max={100}
                    onChange={(n) => set((x) => (x.intent.timing_points = { ...x.intent.timing_points, [o.value]: n }))}
                  />
                ))}
            </div>
          )}
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <NumIn label="Answered by voice" value={s.intent.voice_points} min={0} max={100} onChange={(n) => set((x) => (x.intent.voice_points = n))} />
            <NumIn label="All optional answered" value={s.intent.all_optional_points} min={0} max={100} onChange={(n) => set((x) => (x.intent.all_optional_points = n))} />
            <NumIn label="OK to WhatsApp" value={s.intent.whatsapp_points} min={0} max={100} onChange={(n) => set((x) => (x.intent.whatsapp_points = n))} />
            <NumIn label="Normal duration" value={s.intent.duration_points} min={0} max={100} onChange={(n) => set((x) => (x.intent.duration_points = n))} />
            <NumIn label="Normal from (s)" value={s.intent.duration_min_seconds} min={0} onChange={(n) => set((x) => (x.intent.duration_min_seconds = n))} />
            <NumIn label="Normal up to (s)" value={s.intent.duration_max_seconds} min={0} onChange={(n) => set((x) => (x.intent.duration_max_seconds = n))} />
            <NumIn label="Bot if faster than (s)" value={s.intent.bot_below_seconds} min={0} onChange={(n) => set((x) => (x.intent.bot_below_seconds = n))} />
          </div>
          <button type="button" className="btn-ghost" onClick={() => onChange(structuredClone(DEFAULT_PROFILE_SETTINGS))}>
            Reset to defaults
          </button>
        </div>
      )}
    </section>
  );
}

