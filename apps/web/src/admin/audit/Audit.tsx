// Audit log: every config change and lead-management change, with old/new values.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { must, qk, supabase } from '../api.ts';
import type { AuditRow } from '../types.ts';
import { Badge, Empty, ErrorBox, Spinner } from '../ui.tsx';
import { diffRows } from './diff.ts';
import { Icon } from '../../lib/icons.tsx';

const PAGE = 50;
const TABLES = ['', 'questions', 'question_options', 'form_versions', 'profile_sets', 'profiles', 'profile_conditions', 'never_rules', 'properties', 'admins', 'responses'];

export default function Audit() {
  const [page, setPage] = useState(0);
  const [table, setTable] = useState('');
  const q = useQuery({
    queryKey: qk.audit(page, table),
    queryFn: async () => {
      let b = supabase.from('audit_log').select('*').order('id', { ascending: false }).range(page * PAGE, page * PAGE + PAGE);
      if (table) b = b.eq('table_name', table);
      return must(await b) as AuditRow[];
    },
  });
  const admins = useQuery({
    queryKey: ['admin-emails'],
    queryFn: async () => must(await supabase.from('admins').select('user_id, email')) as { user_id: string; email: string }[],
  });
  const rows = (q.data ?? []).slice(0, PAGE);
  const hasMore = (q.data?.length ?? 0) > PAGE;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="page-title mr-auto">Audit log</h1>
        <label className="sr-only" htmlFor="au-table">
          Table
        </label>
        <select
          id="au-table"
          className="input h-10 w-full py-0 text-sm sm:w-auto"
          value={table}
          onChange={(e) => {
            setTable(e.target.value);
            setPage(0);
          }}
        >
          {TABLES.map((t) => (
            <option key={t} value={t}>
              {t || 'All changes'}
            </option>
          ))}
        </select>
      </div>
      {q.isLoading ? (
        <Spinner />
      ) : q.error ? (
        <ErrorBox error={q.error} onRetry={() => q.refetch()} />
      ) : !rows.length ? (
        <Empty>No changes recorded.</Empty>
      ) : (
        <ul className="card divide-y divide-stone-100">
          {rows.map((r) => {
            const d = diffRows(r.old_data, r.new_data);
            return (
              <li key={r.id} className="text-sm">
                <details className="group">
                  <summary className="flex min-h-12 cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2.5 hover:bg-stone-50 [&::-webkit-details-marker]:hidden">
                    <Icon name="down" size={16} className="-rotate-90 text-stone-400 transition-transform group-open:rotate-0" />
                    <Badge tone={r.action === 'delete' ? 'red' : r.action === 'insert' ? 'green' : 'blue'}>{r.action}</Badge>
                    <span className="font-medium">{r.table_name}</span>
                    <span className="min-w-0 max-w-full truncate text-stone-600">{label(r)}</span>
                    <span className="w-full pl-6 text-xs text-stone-500 sm:ml-auto sm:w-auto sm:pl-0">
                      {format(new Date(r.created_at), 'd MMM yyyy, HH:mm:ss')} · {r.actor ? (admins.data?.find((a) => a.user_id === r.actor)?.email ?? r.actor.slice(0, 8)) : 'system'}
                    </span>
                  </summary>
                  <div className="overflow-x-auto px-3 pb-3">
                    <table className="w-full min-w-[30rem] table-fixed text-xs">
                      <thead>
                        <tr className="border-b border-stone-100 text-left text-stone-500">
                          <th className="w-1/4 py-1.5 font-medium">Field</th>
                          <th className="py-1.5 font-medium">Before</th>
                          <th className="w-6 py-1.5" aria-hidden />
                          <th className="py-1.5 font-medium">After</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-50">
                        {d.map((x) => (
                          <tr key={x.field} className="align-top">
                            <td className="py-1.5 pr-2 font-mono text-stone-700">{x.field}</td>
                            <td className="break-all py-1.5 pr-2 text-red-800">{x.before}</td>
                            <td className="py-1.5 text-stone-400">
                              <Icon name="forward" size={14} className="mt-px" />
                            </td>
                            <td className="break-all py-1.5 text-emerald-800">{x.after}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex items-center justify-between gap-2">
        <button className="btn-secondary" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
          <Icon name="back" size={16} />
          Newer
        </button>
        <span className="text-sm tabular-nums text-stone-500">Page {page + 1}</span>
        <button className="btn-secondary" disabled={!hasMore} onClick={() => setPage((p) => p + 1)}>
          Older
          <Icon name="forward" size={16} />
        </button>
      </div>
    </div>
  );
}

function label(r: AuditRow): string {
  const o = (r.new_data ?? r.old_data ?? {}) as Record<string, unknown>;
  return String(o.label_en ?? o.name ?? o.label ?? o.key ?? o.email ?? (o.version ? `v${o.version}` : (r.row_id ?? '')));
}
