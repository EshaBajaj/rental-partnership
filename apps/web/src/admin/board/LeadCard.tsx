import { Link } from 'react-router-dom';
import { formatDistanceToNowStrict } from 'date-fns';
import { formatPhone, whatsappDigits } from '@shared/phone.ts';
import type { ResponseRow } from '../types.ts';
import { Badge, TierBadge } from '../ui.tsx';
import { Icon } from '../../lib/icons.tsx';
import { PinButton, StatusControl } from './leadMutations.tsx';

export const PATH_LABEL: Record<string, string> = { rent: 'Rent', partner: 'Partner', either: 'Either', waitlist: 'Waitlist' };

export function MatchSummary({ lead }: { lead: ResponseRow }) {
  const best = lead.profile_matches?.[0];
  if (!best) return <p className="text-sm text-stone-500">{lead.path === 'waitlist' ? 'Joined the waitlist (form was closed).' : 'No Ideal Profiles to compare with yet.'}</p>;
  const nearMiss = lead.match_detail?.best_qualified === false;
  return (
    <div className="text-sm">
      <p>
        <span className="font-medium">{best.name}</span> · {best.match}%{' '}
        {nearMiss && (
          <Badge tone="amber" title="A must-have condition was not met">
            near miss
          </Badge>
        )}
      </p>
      <ul className="mt-1.5 space-y-1 text-stone-700">
        {best.failed_must.slice(0, 2).map((r, i) => (
          <li key={`f${i}`} className="flex gap-1.5 text-red-700">
            <Icon name="close" size={16} className="mt-0.5" />
            <span className="sr-only">Failed must-have: </span>
            <span className="min-w-0">{r.text}</span>
          </li>
        ))}
        {best.matched.slice(0, 3).map((r, i) => (
          <li key={`m${i}`} className="flex gap-1.5 text-emerald-800">
            <Icon name="tick" size={16} className="mt-0.5" />
            <span className="sr-only">Matched: </span>
            <span className="min-w-0">{r.text}</span>
          </li>
        ))}
        {best.missed.slice(0, 2).map((r, i) => (
          <li key={`x${i}`} className="flex gap-1.5 text-stone-500">
            <Icon name="minus" size={16} className="mt-0.5" />
            <span className="sr-only">Not matched: </span>
            <span className="min-w-0">{r.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LeadCard({ lead }: { lead: ResponseRow }) {
  return (
    <article className={`card flex flex-col p-4 ${lead.pinned ? 'ring-2 ring-amber-300' : ''}`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <Link to={`/admin/leads/${lead.id}`} className="group inline-flex max-w-full items-center gap-1 text-base font-semibold text-stone-900 hover:text-brand-800">
            <span className="truncate">{lead.name}</span>
            <Icon name="forward" size={16} className="text-stone-400 group-hover:text-brand-700" />
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <TierBadge tier={lead.tier} />
            <Badge>{PATH_LABEL[lead.path] ?? lead.path}</Badge>
            {lead.duplicate_of && (
              <Link to={`/admin/leads/${lead.duplicate_of}`}>
                <Badge tone="violet" title="Same phone number within 30 days">
                  <span className="inline-flex items-center gap-0.5">
                    duplicate <Icon name="external" size={12} />
                  </span>
                </Badge>
              </Link>
            )}
            {lead.suspected_bot && (
              <Badge tone="red" title="Finished the form in under 15 seconds">
                suspected bot
              </Badge>
            )}
            {lead.never_hit.map((n) => (
              <Badge key={n.label} tone="red" title={n.text}>
                <span className="inline-flex items-center gap-1">
                  <Icon name="blocked" size={12} /> {n.label}
                </span>
              </Badge>
            ))}
          </div>
          <p className="mt-1 text-xs text-stone-500">
            {formatDistanceToNowStrict(new Date(lead.created_at), { addSuffix: true })} · intent {lead.intent_score} · priority {lead.priority}
          </p>
        </div>
        <PinButton lead={lead} />
      </div>
      <div className="mt-3 flex-1">
        <MatchSummary lead={lead} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-stone-100 pt-3">
        <a className="btn-secondary min-w-0 flex-1 sm:flex-none" href={`tel:${lead.phone_e164}`} aria-label={`Call ${formatPhone(lead.phone_e164)}`}>
          <Icon name="call" />
          <span className="truncate tabular-nums">{formatPhone(lead.phone_e164)}</span>
        </a>
        {lead.whatsapp_ok && (
          <a
            className="btn-secondary btn-icon sm:w-auto sm:px-4"
            href={`https://wa.me/${whatsappDigits(lead.phone_e164)}`}
            target="_blank"
            rel="noreferrer"
            aria-label="WhatsApp"
          >
            <Icon name="whatsapp" className="text-emerald-700" />
            <span className="hidden sm:inline">WhatsApp</span>
          </a>
        )}
        <div className="w-full sm:ml-auto sm:w-auto">
          <StatusControl lead={lead} compact />
        </div>
      </div>
    </article>
  );
}
