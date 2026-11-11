// Spreadsheet view of the leads board: one row per lead, sortable columns, row actions on the right.
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { format, formatDistanceToNowStrict } from 'date-fns';
import { formatPhone, whatsappDigits } from '@shared/phone.ts';
import type { ResponseRow } from '../types.ts';
import { TierBadge } from '../ui.tsx';
import { Icon } from '../../lib/icons.tsx';
import { PATH_LABEL } from './LeadCard.tsx';
import { PinButton, StatusControl } from './leadMutations.tsx';

type SortKey = 'name' | 'tier' | 'match' | 'intent' | 'priority' | 'created';
type Sort = { key: SortKey; dir: 1 | -1 } | null;

const VALUE: Record<SortKey, (l: ResponseRow) => string | number> = {
  name: (l) => l.name.toLowerCase(),
  tier: (l) => l.tier_rank,
  match: (l) => l.profile_matches?.[0]?.match ?? -1,
  intent: (l) => l.intent_score,
  priority: (l) => l.priority,
  created: (l) => l.created_at,
};

export function LeadTable({ leads }: { leads: ResponseRow[] }) {
  // null = the board's own order (pinned, tier, priority, newest)
  const [sort, setSort] = useState<Sort>(null);
  const nav = useNavigate();
  const rows = useMemo(() => {
    if (!sort) return leads;
    const get = VALUE[sort.key];
    return [...leads].sort((a, b) => (get(a) < get(b) ? -1 : get(a) > get(b) ? 1 : 0) * sort.dir);
  }, [leads, sort]);

  const head = (key: SortKey, label: string, align: 'left' | 'right' = 'left', firstDir: 1 | -1 = 1, extra = '') => {
    const on = sort?.key === key;
    return (
      <th scope="col" aria-sort={on ? (sort!.dir === 1 ? 'ascending' : 'descending') : 'none'} className={`px-3 py-0 ${align === 'right' ? 'text-right' : 'text-left'} ${extra}`}>
        <button
          className={`inline-flex h-10 items-center gap-1 font-semibold uppercase tracking-wide hover:text-stone-900 ${on ? 'text-brand-800' : ''}`}
          onClick={() => setSort(!on ? { key, dir: firstDir } : sort!.dir === firstDir ? { key, dir: (firstDir * -1) as 1 | -1 } : null)}
          title="Sort"
        >
          {label}
          <Icon name="down" size={14} className={`transition ${on ? (sort!.dir === 1 ? 'rotate-180' : '') : 'opacity-0'}`} />
        </button>
      </th>
    );
  };

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[960px] border-collapse text-sm">
          <thead className="sticky top-0 z-10 border-b border-stone-200 bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
            <tr>
              <th scope="col" className="sticky left-0 z-[1] w-12 bg-stone-50 px-2">
                <span className="sr-only">Pinned</span>
              </th>
              {head('name', 'Lead', 'left', 1, 'sticky left-12 z-[1] bg-stone-50 shadow-[1px_0_0_theme(colors.stone.200)]')}
              {head('tier', 'Tier')}
              <th scope="col" className="px-3 text-left font-semibold">
                Wants
              </th>
              {head('match', 'Best match', 'left', -1)}
              {head('intent', 'Intent', 'right', -1)}
              {head('priority', 'Priority', 'right', -1)}
              <th scope="col" className="px-3 text-left font-semibold">
                Status
              </th>
              {head('created', 'Received', 'left', -1)}
              <th scope="col" className="px-3 text-right font-semibold">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {rows.map((l) => {
              const best = l.profile_matches?.[0];
              const open = () => nav(`/admin/leads/${l.id}`);
              return (
                <tr
                  key={l.id}
                  className={`group cursor-pointer transition-colors hover:bg-brand-50 ${l.pinned ? 'bg-amber-50' : 'bg-white'}`}
                  onClick={(e) => {
                    // a click on a control in the row does its own thing; anywhere else opens the lead
                    if (!(e.target as HTMLElement).closest('a,button,[role="listbox"]')) open();
                  }}
                >
                  <td className={`sticky left-0 z-[1] w-12 px-2 py-2 text-center group-hover:bg-brand-50 ${l.pinned ? 'bg-amber-50' : 'bg-white'}`}>
                    <PinButton lead={l} small />
                  </td>
                  <td className={`sticky left-12 z-[1] max-w-[200px] px-3 py-2 shadow-[1px_0_0_theme(colors.stone.200)] group-hover:bg-brand-50 ${l.pinned ? 'bg-amber-50' : 'bg-white'}`}>
                    <Link to={`/admin/leads/${l.id}`} className="block truncate font-medium text-stone-900 hover:text-brand-800">
                      {l.name}
                    </Link>
                    <div className="mt-0.5 flex items-center gap-1.5 whitespace-nowrap text-xs text-stone-500">
                      <span className="tabular-nums">{formatPhone(l.phone_e164)}</span>
                      {l.duplicate_of && <Flag icon="external" tone="text-violet-800" title="Duplicate: same phone within 30 days" />}
                      {l.suspected_bot && <Flag icon="alert" tone="text-red-700" title="Suspected bot: finished in under 15 seconds" />}
                      {l.never_hit.length > 0 && <Flag icon="blocked" tone="text-red-700" title={`Never rule: ${l.never_hit.map((n) => n.label).join(', ')}`} />}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <TierBadge tier={l.tier} />
                  </td>
                  <td className="px-3 py-2 text-stone-700">{PATH_LABEL[l.path] ?? l.path}</td>
                  <td className="px-3 py-2">
                    {best ? (
                      <div className="w-44">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-stone-800" title={best.name}>
                            {best.name}
                          </span>
                          <span className="tabular-nums text-stone-600">{best.match}%</span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-stone-100">
                          <div className={`h-full rounded-full ${l.tier === 'ideal' ? 'bg-emerald-500' : l.tier === 'maybe' ? 'bg-amber-400' : 'bg-stone-300'}`} style={{ width: `${best.match}%` }} />
                        </div>
                      </div>
                    ) : (
                      <span className="text-stone-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-stone-700">{l.intent_score}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-stone-900">{l.priority}</td>
                  <td className="px-3 py-2">
                    <StatusControl lead={l} compact="pill" />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-stone-600" title={format(new Date(l.created_at), 'd MMM yyyy, HH:mm')}>
                    {formatDistanceToNowStrict(new Date(l.created_at), { addSuffix: true })}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <a className="btn-ghost btn-icon h-8 w-8 text-stone-600 hover:text-brand-800" href={`tel:${l.phone_e164}`} title={`Call ${formatPhone(l.phone_e164)}`} aria-label={`Call ${l.name}`}>
                        <Icon name="call" size={18} />
                      </a>
                      {l.whatsapp_ok ? (
                        <a
                          className="btn-ghost btn-icon h-8 w-8 text-emerald-700 hover:text-emerald-800"
                          href={`https://wa.me/${whatsappDigits(l.phone_e164)}`}
                          target="_blank"
                          rel="noreferrer"
                          title="WhatsApp"
                          aria-label={`WhatsApp ${l.name}`}
                        >
                          <Icon name="whatsapp" size={18} />
                        </a>
                      ) : (
                        <span className="inline-flex h-8 w-8 items-center justify-center text-stone-300" title="No WhatsApp">
                          <Icon name="whatsapp" size={18} />
                        </span>
                      )}
                      <Link className="btn-ghost btn-icon h-8 w-8 text-stone-600 hover:text-brand-800" to={`/admin/leads/${l.id}`} title="Open lead" aria-label={`Open ${l.name}`}>
                        <Icon name="forward" size={18} />
                      </Link>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Flag({ icon, tone, title }: { icon: 'external' | 'alert' | 'blocked'; tone: string; title: string }) {
  return (
    <span className={tone} title={title}>
      <Icon name={icon} size={13} label={title} />
    </span>
  );
}
