// CSV export of leads (RFC 4180, Excel-friendly with BOM; guards against formula injection).
import type { ResponseRow } from '../types.ts';

export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = Array.isArray(v) ? v.join('; ') : typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function leadsToCsv(leads: ResponseRow[], answerKeys: { key: string; label: string }[]): string {
  const header = [
    'Created', 'Name', 'Phone', 'WhatsApp OK', 'Path', 'Tier', 'Best profile', 'Match %', 'Qualified', 'Intent', 'Priority',
    'Status', 'Lost reason', 'Pinned', 'Duplicate of', 'Suspected bot', 'Never rules hit', 'Notes',
    ...answerKeys.map((a) => a.label),
  ];
  const rows = leads.map((l) => [
    l.created_at, l.name, l.phone_e164, l.whatsapp_ok ? 'yes' : 'no', l.path, l.tier, l.match_detail?.best_profile_name ?? '',
    l.best_match ?? '', l.match_detail?.best_qualified ? 'yes' : 'no', l.intent_score, l.priority, l.pipeline_status,
    l.lost_reason ?? '', l.pinned ? 'yes' : 'no', l.duplicate_of ?? '', l.suspected_bot ? 'yes' : 'no',
    l.never_hit.map((n) => n.label).join('; '), l.notes ?? '',
    ...answerKeys.map((a) => l.answers?.[a.key]?.display ?? ''),
  ]);
  return toCsv(header, rows);
}
