// Lead-management mutations shared by the board and the lead detail page.
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { PipelineStatus } from '@shared/types.ts';
import { PIPELINE_STATUSES } from '@shared/types.ts';
import { must, supabase } from '../api.ts';
import type { ResponseRow } from '../types.ts';
import { Modal, useToast } from '../ui.tsx';
import { Icon } from '../../lib/icons.tsx';
import { Select } from '../Select.tsx';

export const STATUS_LABEL: Record<PipelineStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  visit_scheduled: 'Visit scheduled',
  negotiating: 'Negotiating',
  won: 'Won',
  lost: 'Lost',
};

/** One colour per pipeline stage, used for dots in the status dropdown and the table. */
export const STATUS_DOT: Record<PipelineStatus, string> = {
  new: 'bg-brand-400',
  contacted: 'bg-brand-700',
  visit_scheduled: 'bg-amber-400',
  negotiating: 'bg-amber-600',
  won: 'bg-emerald-500',
  lost: 'bg-stone-400',
};
const STATUS_OPTIONS = PIPELINE_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s], dot: STATUS_DOT[s] }));

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

export function StatusControl({ lead, compact }: { lead: ResponseRow; compact?: boolean | 'pill' }) {
  const m = useUpdateLead();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  return (
    <>
      <Select
        label="Status"
        value={lead.pipeline_status}
        options={STATUS_OPTIONS}
        disabled={m.isPending}
        variant={compact === 'pill' ? 'pill' : 'field'}
        size={compact === 'pill' ? 'sm' : 'md'}
        className={compact === 'pill' ? 'w-40' : compact ? 'w-full sm:w-44' : 'w-full'}
        onChange={(s) => {
          if (s === 'lost') {
            setReason(lead.lost_reason ?? '');
            setAsking(true);
          } else m.mutate({ id: lead.id, patch: { pipeline_status: s } });
        }}
      />
      {asking && (
        <Modal title="Why was this lead lost?" onClose={() => setAsking(false)}>
          <label className="label" htmlFor={`lr-${lead.id}`}>
            Reason (optional)
          </label>
          <input id={`lr-${lead.id}`} className="input" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. budget too low, took another shop" autoFocus />
          <div className="mt-4 flex flex-wrap justify-end gap-2">
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

export function PinButton({ lead, small }: { lead: ResponseRow; small?: boolean }) {
  const m = useUpdateLead();
  return (
    <button
      className={`btn-ghost btn-icon ${small ? 'h-8 w-8' : ''} ${lead.pinned ? 'text-amber-500 hover:text-amber-600' : 'text-stone-400 hover:text-stone-600'}`}
      aria-pressed={lead.pinned}
      aria-label={lead.pinned ? 'Unpin lead' : 'Pin lead to top'}
      title={lead.pinned ? 'Unpin' : 'Pin to top'}
      disabled={m.isPending}
      onClick={() => m.mutate({ id: lead.id, patch: { pinned: !lead.pinned } })}
    >
      <Icon name="star" size={small ? 18 : 20} filled={lead.pinned} />
    </button>
  );
}
