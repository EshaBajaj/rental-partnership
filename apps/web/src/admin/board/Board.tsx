// Leads board — the default admin screen.
import { normalizeConfig } from '@shared/input-modes.ts';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PIPELINE_STATUSES, type PipelineStatus, type Tier } from '@shared/types.ts';
import { must, qk, supabase } from '../api.ts';
import { useAdmin } from '../context.tsx';
import type { FormVersionRow, ResponsePathValue, ResponseRow, SavedViewRow } from '../types.ts';
import { download, Empty, ErrorBox, Spinner, TIER_LABEL, useConfirm, useDebounced, useToast } from '../ui.tsx';
import { applyFilters, type BoardFilters, countActive, DEFAULT_FILTERS, normaliseFilters } from './filters.ts';
import { leadsToCsv } from './csv.ts';
import { LeadCard, PATH_LABEL } from './LeadCard.tsx';
import { LeadTable } from './LeadTable.tsx';
import { Select } from '../Select.tsx';
import { STATUS_LABEL } from './leadMutations.tsx';
import { Icon } from '../../lib/icons.tsx';

const LIMIT = 500;
const FILTER_KEY = 'sls.admin.boardFilters';
const VIEW_KEY = 'sls.admin.boardView';
type View = 'table' | 'cards';

function loadView(): View {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (v === 'table' || v === 'cards') return v;
  } catch {
    /* private mode */
  }
  // spreadsheet on wide screens, cards on phones
  return typeof window !== 'undefined' && window.innerWidth >= 768 ? 'table' : 'cards';
}

function loadFilters(): BoardFilters {
  try {
    return normaliseFilters(JSON.parse(sessionStorage.getItem(FILTER_KEY) ?? '{}'));
  } catch {
    return DEFAULT_FILTERS;
  }
}

export function Board() {
  const { property } = useAdmin();
  const qc = useQueryClient();
  const toast = useToast();
  const [filters, setFilters] = useState<BoardFilters>(loadFilters);
  const [showFilters, setShowFilters] = useState(false);
  const [view, setViewState] = useState<View>(loadView);
  const setView = (v: View) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* private mode */
    }
  };
  const debounced = useDebounced(filters, 300);
  useEffect(() => {
    try {
      sessionStorage.setItem(FILTER_KEY, JSON.stringify(filters));
    } catch {
      /* ignore */
    }
  }, [filters]);

  const leads = useQuery({
    queryKey: qk.leads(property.id, debounced),
    queryFn: async () => {
      const base = supabase.from('responses').select('*').eq('property_id', property.id);
      const q = applyFilters(base, debounced)
        .order('pinned', { ascending: false })
        .order('tier_rank', { ascending: true })
        .order('priority', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(LIMIT);
      return must(await q) as ResponseRow[];
    },
  });

  const profileNames = useQuery({
    queryKey: ['profile-names', property.id],
    queryFn: async () => {
      const sets = must(await supabase.from('profile_sets').select('id').eq('property_id', property.id).eq('is_current', true)) as { id: string }[];
      if (!sets.length) return [] as string[];
      const ps = must(await supabase.from('profiles').select('name').eq('profile_set_id', sets[0].id).order('position')) as { name: string }[];
      return ps.map((p) => p.name);
    },
  });

  // realtime: new and updated leads
  useEffect(() => {
    const ch = supabase
      .channel(`responses-${property.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'responses', filter: `property_id=eq.${property.id}` }, (payload) => {
        qc.invalidateQueries({ queryKey: ['leads', property.id] });
        if (payload.eventType === 'INSERT') {
          const r = payload.new as Partial<ResponseRow>;
          toast(`New lead: ${r.name ?? ''}${r.tier ? ` (${TIER_LABEL[r.tier as Tier]})` : ''}`, 'success');
        }
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [property.id, qc, toast]);

  const counts = useMemo(() => {
    const c: Record<Tier, number> = { ideal: 0, maybe: 0, no: 0 };
    for (const l of leads.data ?? []) c[l.tier]++;
    return c;
  }, [leads.data]);

  async function exportCsv() {
    const fv = must(
      await supabase.from('form_versions').select('config').eq('property_id', property.id).eq('is_current', true).maybeSingle(),
    ) as Pick<FormVersionRow, 'config'> | null;
    const keys = (fv ? normalizeConfig(fv.config).questions : []).filter((q) => q.kind !== 'contact').map((q) => ({ key: q.key, label: q.label_en }));
    download(`leads-${property.slug}-${new Date().toISOString().slice(0, 10)}.csv`, leadsToCsv(leads.data ?? [], keys), 'text/csv;charset=utf-8');
  }

  const set = <K extends keyof BoardFilters>(k: K, v: BoardFilters[K]) => setFilters((f) => ({ ...f, [k]: v }));
  const toggle = <T extends string>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const active = countActive(filters);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="page-title mr-auto">Leads</h1>
        <div className="flex w-full gap-1.5 sm:w-auto" role="group" aria-label="Filter by tier">
          {(['ideal', 'maybe', 'no'] as Tier[]).map((t) => (
            <Chip key={t} on={filters.tiers.includes(t)} onClick={() => set('tiers', toggle(filters.tiers, t))} grow>
              {TIER_LABEL[t]}
              {leads.data ? <span className={`tabular-nums ${filters.tiers.includes(t) ? 'text-brand-100' : 'text-stone-500'}`}>{counts[t]}</span> : null}
            </Chip>
          ))}
        </div>
      </div>

      <div className="card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="search">
            Search name or phone
          </label>
          <div className="relative min-w-0 basis-full sm:basis-0 sm:flex-1">
            <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
            <input id="search" type="search" className="input h-10 py-0 pl-10" placeholder="Search name or phone" value={filters.q} onChange={(e) => set('q', e.target.value)} />
          </div>
          <button
            className={`btn-secondary flex-1 sm:flex-none ${showFilters || active ? 'border-brand-300 text-brand-800' : ''}`}
            onClick={() => setShowFilters((s) => !s)}
            aria-expanded={showFilters}
            aria-controls="board-filters"
          >
            <Icon name="filter" />
            Filters
            {active > 0 && <span className="rounded-full bg-brand-700 px-1.5 text-xs font-semibold leading-5 text-white tabular-nums">{active}</span>}
            <Icon name="down" size={16} className={`transition-transform ${showFilters ? 'rotate-180' : ''}`} />
          </button>
          {active > 0 && (
            <button className="btn-ghost" onClick={() => setFilters(DEFAULT_FILTERS)}>
              <Icon name="close" size={16} />
              Clear
            </button>
          )}
          <div className="inline-flex h-10 rounded-xl bg-stone-100 p-1" role="group" aria-label="Layout">
            {(['table', 'cards'] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => setView(v)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition ${view === v ? 'bg-white text-brand-800 shadow-sm' : 'text-stone-600 hover:text-stone-900'}`}
              >
                <Icon name={v} size={16} />
                {v === 'table' ? 'Table' : 'Cards'}
              </button>
            ))}
          </div>
          <button className="btn-secondary flex-1 sm:flex-none" onClick={exportCsv} disabled={!leads.data?.length}>
            <Icon name="download" />
            Export CSV
          </button>
        </div>
        {showFilters && (
          <div id="board-filters" className="mt-3 grid gap-4 border-t border-stone-100 pt-3 sm:grid-cols-2 lg:grid-cols-3">
            <fieldset>
              <legend className="label">Status</legend>
              <div className="flex flex-wrap gap-1.5">
                {PIPELINE_STATUSES.map((s) => (
                  <Chip key={s} on={filters.statuses.includes(s)} onClick={() => set('statuses', toggle<PipelineStatus>(filters.statuses, s))}>
                    {STATUS_LABEL[s]}
                  </Chip>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="label">Wants to</legend>
              <div className="flex flex-wrap gap-1.5">
                {(['rent', 'partner', 'either', 'waitlist'] as ResponsePathValue[]).map((p) => (
                  <Chip key={p} on={filters.paths.includes(p)} onClick={() => set('paths', toggle(filters.paths, p))}>
                    {PATH_LABEL[p]}
                  </Chip>
                ))}
              </div>
            </fieldset>
            <div>
              <span className="label">Best profile</span>
              <Select
                label="Best profile"
                className="w-full"
                value={filters.profile}
                options={[{ value: '', label: 'Any profile' }, ...(profileNames.data ?? []).map((n) => ({ value: n, label: n }))]}
                onChange={(v) => set('profile', v)}
              />
            </div>
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                <label className="label" htmlFor="f-from">
                  From
                </label>
                <input id="f-from" type="date" className="input" value={filters.from} onChange={(e) => set('from', e.target.value)} />
              </div>
              <div className="min-w-0 flex-1">
                <label className="label" htmlFor="f-to">
                  To
                </label>
                <input id="f-to" type="date" className="input" value={filters.to} onChange={(e) => set('to', e.target.value)} />
              </div>
            </div>
            <div className="flex flex-col justify-end text-sm text-stone-700">
              <label className="flex min-h-10 cursor-pointer items-center gap-2">
                <input type="checkbox" className="h-4 w-4 accent-brand-700" checked={filters.includeDuplicates} onChange={(e) => set('includeDuplicates', e.target.checked)} /> Include duplicates
              </label>
              <label className="flex min-h-10 cursor-pointer items-center gap-2">
                <input type="checkbox" className="h-4 w-4 accent-brand-700" checked={filters.includeBots} onChange={(e) => set('includeBots', e.target.checked)} /> Include suspected bots
              </label>
            </div>
          </div>
        )}
        <SavedViews filters={filters} onApply={setFilters} />
      </div>

      {leads.isLoading ? (
        <Spinner />
      ) : leads.error ? (
        <ErrorBox error={leads.error} onRetry={() => leads.refetch()} />
      ) : !leads.data?.length ? (
        <Empty>{active ? 'No leads match these filters.' : 'No leads yet. Share the QR code (Settings → QR poster) to start collecting.'}</Empty>
      ) : (
        <>
          {view === 'table' ? (
            <LeadTable leads={leads.data} />
          ) : (
            <div className="grid gap-3 xl:grid-cols-2">
              {leads.data.map((l) => (
                <LeadCard key={l.id} lead={l} />
              ))}
            </div>
          )}
          {leads.data.length >= LIMIT && <p className="text-center text-sm text-stone-500">Showing the top {LIMIT}. Use filters or Export CSV to see more.</p>}
        </>
      )}
    </div>
  );
}

function Chip({ on, onClick, children, grow }: { on: boolean; onClick: () => void; children: React.ReactNode; grow?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`inline-flex h-10 items-center justify-center gap-1.5 rounded-full px-3.5 text-sm font-medium ring-1 transition ${grow ? 'flex-1 sm:flex-none' : ''} ${
        on ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-stone-700 ring-stone-300 hover:bg-stone-50 hover:ring-stone-400'
      }`}
    >
      {on && <Icon name="tick" size={16} />}
      {children}
    </button>
  );
}

function SavedViews({ filters, onApply }: { filters: BoardFilters; onApply: (f: BoardFilters) => void }) {
  const { property, session } = useAdmin();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [name, setName] = useState('');
  const views = useQuery({
    queryKey: qk.savedViews(property.id),
    queryFn: async () => must(await supabase.from('saved_views').select('*').eq('property_id', property.id).order('created_at')) as SavedViewRow[],
  });
  const save = useMutation({
    mutationFn: async () =>
      must(await supabase.from('saved_views').insert({ property_id: property.id, user_id: session.user.id, name: name.trim(), filters }).select('id').single()),
    onSuccess: () => {
      setName('');
      toast('View saved', 'success');
      qc.invalidateQueries({ queryKey: qk.savedViews(property.id) });
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });
  const del = useMutation({
    mutationFn: async (id: string) => must(await supabase.from('saved_views').delete().eq('id', id).select('id')),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.savedViews(property.id) }),
    onError: (e) => toast((e as Error).message, 'error'),
  });
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-stone-100 pt-3 text-sm">
      <span className="text-stone-500">Saved views:</span>
      {(views.data ?? []).map((v) => (
        <span key={v.id} className="inline-flex h-10 items-center rounded-full bg-stone-100 ring-1 ring-stone-200">
          <button className="h-full rounded-l-full pl-3.5 pr-1 font-medium text-stone-800 hover:text-brand-800" onClick={() => onApply(normaliseFilters(v.filters))}>
            {v.name}
          </button>
          <button
            className="flex h-full w-9 items-center justify-center rounded-r-full text-stone-400 hover:text-red-600"
            aria-label={`Delete view ${v.name}`}
            onClick={async () => (await confirm({ title: 'Delete saved view?', body: `“${v.name}” will be removed.`, confirm: 'Delete', danger: true })) && del.mutate(v.id)}
          >
            <Icon name="close" size={16} />
          </button>
        </span>
      ))}
      {!views.data?.length && <span className="text-stone-400">none</span>}
      <form
        className="flex w-full gap-2 sm:ml-auto sm:w-auto"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) save.mutate();
        }}
      >
        <label className="sr-only" htmlFor="view-name">
          New view name
        </label>
        <input id="view-name" className="input h-10 min-w-0 flex-1 py-0 text-sm sm:w-40 sm:flex-none" placeholder="Name this view" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn-secondary" disabled={!name.trim() || save.isPending}>
          <Icon name="add" size={16} />
          Save view
        </button>
      </form>
    </div>
  );
}
