// Load the profile conditions / never rules that may depend on a question (draft + current set).
import { must, supabase } from '../api.ts';
import type { NeverRuleRow, ProfileRow, ProfileSetRow } from '../types.ts';
import type { PlanCondition, PlanNever } from './removal.ts';

export interface ProfileRefs {
  draftId: string | null;
  currentId: string | null;
  draftConditions: PlanCondition[];
  draftNever: PlanNever[];
  currentConditions: PlanCondition[];
  currentNever: PlanNever[];
}

export async function loadProfileRefs(propertyId: string): Promise<ProfileRefs> {
  const sets = must(
    await supabase.from('profile_sets').select('id, status, is_current').eq('property_id', propertyId).or('status.eq.draft,is_current.eq.true'),
  ) as Pick<ProfileSetRow, 'id' | 'status' | 'is_current'>[];
  const draft = sets.find((s) => s.status === 'draft')?.id ?? null;
  const current = sets.find((s) => s.is_current)?.id ?? null;
  const ids = [draft, current].filter((x): x is string => !!x);
  if (!ids.length) return { draftId: null, currentId: null, draftConditions: [], draftNever: [], currentConditions: [], currentNever: [] };
  const profiles = must(await supabase.from('profiles').select('*, profile_conditions(*)').in('profile_set_id', ids)) as ProfileRow[];
  const never = must(await supabase.from('never_rules').select('*').in('profile_set_id', ids)) as NeverRuleRow[];
  const conds = (setId: string | null): PlanCondition[] =>
    profiles
      .filter((p) => p.profile_set_id === setId)
      .flatMap((p) =>
        p.profile_conditions.map((c) => ({
          id: c.id,
          profile_name: p.name,
          question_key: c.question_key,
          operator: c.operator,
          value: c.value,
          importance: c.importance,
        })),
      );
  const nev = (setId: string | null): PlanNever[] =>
    never.filter((n) => n.profile_set_id === setId).map((n) => ({ id: n.id, question_key: n.question_key, operator: n.operator, value: n.value, label: n.label }));
  return {
    draftId: draft,
    currentId: current,
    draftConditions: conds(draft),
    draftNever: nev(draft),
    currentConditions: current === draft ? [] : conds(current),
    currentNever: current === draft ? [] : nev(current),
  };
}
