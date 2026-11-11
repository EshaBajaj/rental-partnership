// Lead-management mutations shared by the board and the lead detail page.
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { PipelineStatus } from '@shared/types.ts';
import { PIPELINE_STATUSES } from '@shared/types.ts';
import { must, supabase } from '../api.ts';
import type { ResponseRow } from '../types.ts';
import { Modal, useToast } from '../ui.tsx';

export const STATUS_LABEL: Record<PipelineStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  visit_scheduled: 'Visit scheduled',
  negotiating: 'Negotiating',
  won: 'Won',
  lost: 'Lost',
};

type Patch = Partial<Pick<ResponseRow, 'pipeline_status' | 'lost_reason' | 'pinned' | 'notes'>>;

export function useUpdateLead() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Patch }) =>
      must(await supabase.from('responses').update(patch).eq('id', id).select('id').single()),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['lead', v.id] });
      qc.invalidateQueries({ queryKey: ['lead-events', v.id] });
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });
}

export function StatusControl({ lead, compact }: { lead: ResponseRow; compact?: boolean }) {
  const m = useUpdateLead();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  return (
    <>
      <label className="sr-only" htmlFor={`st-${lead.id}`}>
        Status
      </label>
      <select
        id={`st-${lead.id}`}
        className={`input ${compact ? 'w-auto py-1 text-sm' : ''}`}
        value={lead.pipeline_status}
        disabled={m.isPending}
        onChange={(e) => {
          const s = e.target.value as PipelineStatus;
          if (s === 'lost') {
            setReason(lead.lost_reason ?? '');
            setAsking(true);
          } else m.mutate({ id: lead.id, patch: { pipeline_status: s } });
        }}
      >
        {PIPELINE_STATUSES.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABEL[s]}
          </option>
        ))}
      </select>
      {asking && (
        <Modal title="Why was this lead lost?" onClose={() => setAsking(false)}>
          <label className="label" htmlFor={`lr-${lead.id}`}>
            Reason (optional)
          </label>
          <input id={`lr-${lead.id}`} className="input" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. budget too low, took another shop" autoFocus />
          <div className="mt-4 flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setAsking(false)}>
              Cancel
            </button>
            <button
              className="btn-primary"
              onClick={() => {
                m.mutate({ id: lead.id, patch: { pipeline_status: 'lost', lost_reason: reason.trim() || null } });
                setAsking(false);
              }}
            >
              Mark as lost
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

export function PinButton({ lead }: { lead: ResponseRow }) {
  const m = useUpdateLead();
  return (
    <button
      className={`btn-ghost px-2 py-1 ${lead.pinned ? 'text-amber-600' : 'text-stone-400'}`}
      aria-pressed={lead.pinned}
      aria-label={lead.pinned ? 'Unpin lead' : 'Pin lead to top'}
      title={lead.pinned ? 'Unpin' : 'Pin to top'}
      disabled={m.isPending}
      onClick={() => m.mutate({ id: lead.id, patch: { pinned: !lead.pinned } })}
    >
      {lead.pinned ? '★' : '☆'}
    </button>
  );
}
