// Funnel: views → starts → per question → submitted.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, subDays } from 'date-fns';
import { must, qk, supabase } from '../api.ts';
import { useAdmin } from '../context.tsx';
import type { FormVersionRow, FunnelEventRow } from '../types.ts';
import { Empty, ErrorBox, Spinner } from '../ui.tsx';
import { nextDay } from '../board/filters.ts';
import { computeFunnel, formatDuration, median } from './funnel.ts';

const PAGE = 1000;
const MAX_EVENTS = 20_000;

export default function Funnel() {
  const { property } = useAdmin();
  const [from, setFrom] = useState(format(subDays(new Date(), 30), 'yyyy-MM-dd'));
  const [to, setTo] = useState(format(new Date(), 'yyyy-MM-dd'));
  const q = useQuery({
    queryKey: qk.funnel(property.id, from, to),
    queryFn: async () => {
      const events: FunnelEventRow[] = [];
      for (let page = 0; events.length < MAX_EVENTS; page++) {
        const rows = must(
          await supabase
            .from('funnel_events')
            .select('session_id, event, question_key, created_at')
            .eq('property_id', property.id)
            .gte('created_at', `${from}T00:00:00`)
            .lt('created_at', `${nextDay(to)}T00:00:00`)
            .order('id')
            .range(page * PAGE, page * PAGE + PAGE - 1),
        ) as FunnelEventRow[];
        events.push(...rows);
        if (rows.length < PAGE) break;
      }
      const durations = must(
        await supabase
          .from('responses')
          .select('duration_seconds')
          .eq('property_id', property.id)
          .neq('path', 'waitlist')
          .gte('created_at', `${from}T00:00:00`)
          .lt('created_at', `${nextDay(to)}T00:00:00`),
      ) as { duration_seconds: number }[];
      const fv = must(await supabase.from('form_versions').select('config').eq('property_id', property.id).eq('is_current', true).maybeSingle()) as Pick<FormVersionRow, 'config'> | null;
      return { events, durations: durations.map((d) => d.duration_seconds), config: fv?.config ?? null, truncated: events.length >= MAX_EVENTS };
    },
  });

  const steps = q.data ? computeFunnel(q.data.events, (q.data.config?.questions ?? []).map((x) => ({ key: x.key, label: x.label_en }))) : [];
  const views = steps[0]?.sessions ?? 0;
  const submits = steps[steps.length - 1]?.sessions ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
        <h1 className="page-title mr-auto">Funnel</h1>
        <div className="flex w-full gap-2 sm:w-auto">
          <div className="min-w-0 flex-1">
            <label className="label" htmlFor="fu-from">
              From
            </label>
            <input id="fu-from" type="date" className="input h-10 py-0 text-sm" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="min-w-0 flex-1">
            <label className="label" htmlFor="fu-to">
              To
            </label>
            <input id="fu-to" type="date" className="input h-10 py-0 text-sm" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
      </div>
      {q.isLoading ? (
        <Spinner />
      ) : q.error ? (
        <ErrorBox error={q.error} onRetry={() => q.refetch()} />
      ) : !views ? (
        <Empty>No visits in this period.</Empty>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label="Opened the form" value={String(views)} />
            <Stat label="Completion rate" value={`${Math.round((submits / views) * 1000) / 10}%`} />
            <Stat label="Median time to finish" value={formatDuration(median(q.data!.durations))} />
          </div>
          <div className="card space-y-3 p-4">
            {steps.map((s) => (
              <div key={s.id}>
                <div className="flex justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate text-stone-800">{s.label}</span>
                  <span className="shrink-0 tabular-nums text-stone-600">
                    {s.sessions} · {s.ofStart}%{s.dropOff > 0 ? <span className="text-red-700"> (−{s.dropOff}%)</span> : null}
                  </span>
                </div>
                <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-stone-100">
                  <div className="h-full rounded-full bg-brand-600 transition-[width] duration-500" style={{ width: `${s.ofStart}%` }} />
                </div>
              </div>
            ))}
            <p className="pt-2 text-xs text-stone-500">
              Counts are unique visits per step. Questions only shown on some paths naturally have fewer answers. Red = lost since the previous step.
              {q.data!.truncated ? ' Only the first 20,000 events are counted; narrow the dates.' : ''}
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-4 last:col-span-2 sm:last:col-span-1">
      <p className="text-sm text-stone-500">{label}</p>
      <p className="mt-0.5 text-2xl font-semibold tabular-nums text-stone-900">{value}</p>
    </div>
  );
}
