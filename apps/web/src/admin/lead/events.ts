// Human text for lead_events rows.
import type { LeadEventRow } from '../types.ts';

const TIER: Record<string, string> = { ideal: 'Ideal', maybe: 'Maybe', no: 'Not a fit' };
const STATUS: Record<string, string> = {
  new: 'New',
  contacted: 'Contacted',
  visit_scheduled: 'Visit scheduled',
  negotiating: 'Negotiating',
  won: 'Won',
  lost: 'Lost',
};

export function eventText(e: Pick<LeadEventRow, 'type' | 'data'>): string {
  const d = e.data ?? {};
  const s = (k: string) => (d[k] === null || d[k] === undefined ? '' : String(d[k]));
  switch (e.type) {
    case 'created':
      return `Submitted (${s('path')}) → ${TIER[s('tier')] ?? s('tier')}${s('best_profile') ? `, best match ${s('best_profile')} ${s('best_match')}%` : ''}`;
    case 'duplicate':
      return 'Same phone number as an earlier lead (last 30 days)';
    case 'tier_changed':
      return `Tier ${TIER[s('from')] ?? s('from')} → ${TIER[s('to')] ?? s('to')} (${s('reason')})`;
    case 'status_changed':
      return `Status ${STATUS[s('from')] ?? s('from')} → ${STATUS[s('to')] ?? s('to')}${s('lost_reason') ? ` — ${s('lost_reason')}` : ''}`;
    case 'pinned':
      return 'Pinned to top';
    case 'unpinned':
      return 'Unpinned';
    case 'notes_updated':
      return `Notes updated: “${s('notes').slice(0, 120)}”`;
    case 'notified':
      return `Alert sent (${s('channel')})`;
    case 'notify_failed':
      return `Alert could not be sent: ${s('error')}`;
    case 'voice_transcribed':
      return `Voice note transcribed (${s('question_key')}${s('language') ? `, ${s('language')}` : ''})`;
    case 'voice_failed':
      return `Voice note could not be transcribed (${s('question_key')}): ${s('error')}`;
    case 'called':
      return 'Called';
    case 'whatsapp_sent':
      return 'WhatsApp sent';
    case 'visit':
      return 'Visited the shop';
    case 'note':
      return `Note: ${s('note')}`;
    default:
      return e.type.replace(/_/g, ' ');
  }
}
