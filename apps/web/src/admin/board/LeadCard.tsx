import { Link } from 'react-router-dom';
import { formatDistanceToNowStrict } from 'date-fns';
import { formatPhone, whatsappDigits } from '@shared/phone.ts';
import type { ResponseRow } from '../types.ts';
import { Badge, TierBadge } from '../ui.tsx';
import { PinButton, StatusControl } from './leadMutations.tsx';

export const PATH_LABEL: Record<string, string> = { rent: 'Rent', partner: 'Partner', either: 'Either', waitlist: 'Waitlist' };

export function MatchSummary({ lead }: { lead: ResponseRow }) {
  const best = lead.profile_matches?.[0];
  if (!best) return <p className="text-sm text-stone-500">{lead.path === 'waitlist' ? 'Joined the waitlist (form was closed).' : 'No Ideal Profiles to compare with yet.'}</p>;
  const nearMiss = lead.match_detail?.best_qualified === false;
  return (
    <div className="text-sm">
      <p>
        <span className="font-medium">{best.name}</span> · {best.match}%
        {nearMiss && (
          <Badge tone="amber" title="A must-have condition was not met">
            near miss
          </Badge>
        )}
      </p>
      <ul className="mt-1 space-y-0.5 text-stone-700">
        {best.failed_must.slice(0, 2).map((r, i) => (
          <li key={`f${i}`} className="text-red-700">
            ✗ {r.text}
          </li>
        ))}
        {best.matched.slice(0, 3).map((r, i) => (
          <li key={`m${i}`} className="text-emerald-800">
            ✓ {r.text}
          </li>
        ))}
        {best.missed.slice(0, 2).map((r, i) => (
          <li key={`x${i}`} className="text-stone-500">
            – {r.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LeadCard({ lead }: { lead: ResponseRow }) {
  return (
    <article className={`card p-4 ${lead.pinned ? 'ring-2 ring-amber-300' : ''}`}>
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <TierBadge tier={lead.tier} />
            <Link to={`/admin/leads/${lead.id}`} className="truncate text-base font-semibold hover:underline">
              {lead.name}
            </Link>
            <Badge>{PATH_LABEL[lead.path] ?? lead.path}</Badge>
            {lead.duplicate_of && (
              <Link to={`/admin/leads/${lead.duplicate_of}`}>
                <Badge tone="violet" title="Same phone number within 30 days">
                  duplicate ↗
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
                ⛔ {n.label}
              </Badge>
            ))}
          </div>
          <p className="mt-1 text-xs text-stone-500">
            {formatDistanceToNowStrict(new Date(lead.created_at), { addSuffix: true })} · intent {lead.intent_score} · priority {lead.priority}
          </p>
        </div>
        <PinButton lead={lead} />
      </div>
      <div className="mt-3">
        <MatchSummary lead={lead} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <a className="btn-secondary px-3 py-1.5 text-sm" href={`tel:${lead.phone_e164}`}>
          📞 {formatPhone(lead.phone_e164)}
        </a>
        {lead.whatsapp_ok && (
          <a className="btn-secondary px-3 py-1.5 text-sm" href={`https://wa.me/${whatsappDigits(lead.phone_e164)}`} target="_blank" rel="noreferrer">
            WhatsApp
          </a>
        )}
        <div className="ml-auto">
          <StatusControl lead={lead} compact />
        </div>
      </div>
    </article>
  );
}
