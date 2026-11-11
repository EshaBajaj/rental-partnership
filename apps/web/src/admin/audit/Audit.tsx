// Audit log: every config change and lead-management change, with old/new values.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { must, qk, supabase } from '../api.ts';
import type { AuditRow } from '../types.ts';
import { Badge, Empty, ErrorBox, Spinner } from '../ui.tsx';
import { diffRows } from './diff.ts';

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
        <h1 className="mr-auto text-xl font-semibold">Audit log</h1>
        <label className="sr-only" htmlFor="au-table">
          Table
        </label>
        <select
          id="au-table"
          className="input w-auto"
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
              <li key={r.id} className="p-3 text-sm">
                <details>
                  <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                    <Badge tone={r.action === 'delete' ? 'red' : r.action === 'insert' ? 'green' : 'blue'}>{r.action}</Badge>
                    <span className="font-medium">{r.table_name}</span>
                    <span className="truncate text-stone-600">{label(r)}</span>
                    <span className="ml-auto text-xs text-stone-500">
                      {format(new Date(r.created_at), 'd MMM yyyy, HH:mm:ss')} · {r.actor ? (admins.data?.find((a) => a.user_id === r.actor)?.email ?? r.actor.slice(0, 8)) : 'system'}
                    </span>
                  </summary>
                  <table className="mt-2 w-full table-fixed text-xs">
                    <thead>
                      <tr className="text-left text-stone-500">
                        <th className="w-1/4 font-normal">Field</th>
                        <th className="font-normal">Before</th>
                        <th className="font-normal">After</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.map((x) => (
                        <tr key={x.field} className="align-top">
                          <td className="pr-2 font-mono">{x.field}</td>
                          <td className="break-all pr-2 text-red-800">{x.before}</td>
                          <td className="break-all text-emerald-800">{x.after}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex justify-between">
        <button className="btn-secondary" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
          ← Newer
        </button>
        <span className="self-center text-sm text-stone-500">Page {page + 1}</span>
        <button className="btn-secondary" disabled={!hasMore} onClick={() => setPage((p) => p + 1)}>
          Older →
        </button>
      </div>
    </div>
  );
}

function label(r: AuditRow): string {
  const o = (r.new_data ?? r.old_data ?? {}) as Record<string, unknown>;
  return String(o.label_en ?? o.name ?? o.label ?? o.key ?? o.email ?? (o.version ? `v${o.version}` : (r.row_id ?? '')));
}
