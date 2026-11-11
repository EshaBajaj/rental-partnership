// Owner-only: list admins, invite by email (Edge Function admin-invite), change role, remove.
// The database refuses to remove/demote the last owner; the UI disables those controls too.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { FUNCTIONS_URL } from '../../lib/env.ts';
import { errMsg, must, qk, supabase } from '../api.ts';
import { useAdmin } from '../context.tsx';
import type { AdminRow } from '../types.ts';
import { Badge, ErrorBox, Spinner, useConfirm, useToast } from '../ui.tsx';
import { inviteResultText, isLastOwner, validEmail } from './lastOwner.ts';
import { Icon } from '../../lib/icons.tsx';

export default function Admins() {
  const { me, session } = useAdmin();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'staff' | 'owner'>('staff');
  const admins = useQuery({
    queryKey: qk.admins,
    queryFn: async () => must(await supabase.from('admins').select('*').order('created_at')) as AdminRow[],
    enabled: me.role === 'owner',
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: qk.admins });
    qc.invalidateQueries({ queryKey: ['admin-emails'] });
  };
  const invite = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${FUNCTIONS_URL}/admin-invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ email: email.trim(), role }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message ?? `Invite failed (HTTP ${res.status})`);
      return body as { invited: boolean };
    },
    onSuccess: (r) => {
      toast(inviteResultText(r), 'success');
      setEmail('');
      refresh();
    },
    onError: (e) => toast(errMsg(e), 'error'),
  });
  const setRoleM = useMutation({
    mutationFn: async ({ id, r }: { id: string; r: 'owner' | 'staff' }) => must(await supabase.from('admins').update({ role: r }).eq('user_id', id).select('user_id')),
    onSuccess: refresh,
    onError: (e) => toast(errMsg(e), 'error'),
  });
  const del = useMutation({
    mutationFn: async (id: string) => must(await supabase.from('admins').delete().eq('user_id', id).select('user_id')),
    onSuccess: refresh,
    onError: (e) => toast(errMsg(e), 'error'),
  });

  if (me.role !== 'owner') return <p className="card p-4 text-sm text-stone-600">Only an owner can manage admins.</p>;
  if (admins.isLoading) return <Spinner />;
  if (admins.error) return <ErrorBox error={admins.error} onRetry={() => admins.refetch()} />;
  const list = admins.data ?? [];

  return (
    <div className="space-y-4">
      <h1 className="page-title">Admins</h1>
      <section className="card p-4">
        <p className="text-sm text-stone-600">
          <b>Owners</b> can do everything, including managing admins. <b>Staff</b> can do everything else. There must always be at least one owner.
        </p>
        <ul className="mt-3 divide-y divide-stone-100">
          {list.map((a) => {
            const last = isLastOwner(a, list);
            return (
              <li key={a.user_id} className="flex flex-wrap items-center gap-2 py-3 text-sm">
                <span className="min-w-0 basis-full truncate sm:basis-0 sm:flex-1">
                  <span className="font-medium text-stone-900">{a.email}</span> {a.user_id === me.user_id && <Badge>you</Badge>}
                  <span className="block text-xs text-stone-500">added {format(new Date(a.created_at), 'd MMM yyyy')}</span>
                </span>
                <label className="sr-only" htmlFor={`role-${a.user_id}`}>
                  Role of {a.email}
                </label>
                <select
                  id={`role-${a.user_id}`}
                  className="input h-10 w-auto flex-1 py-0 text-sm sm:flex-none"
                  value={a.role}
                  disabled={setRoleM.isPending || last}
                  title={last ? 'The only owner cannot be demoted — make someone else an owner first.' : undefined}
                  onChange={(e) => setRoleM.mutate({ id: a.user_id, r: e.target.value as 'owner' | 'staff' })}
                >
                  <option value="owner">Owner</option>
                  <option value="staff">Staff</option>
                </select>
                <button
                  className="btn-ghost text-red-700 hover:bg-red-50"
                  disabled={del.isPending || last}
                  title={last ? 'The only owner cannot be removed.' : undefined}
                  onClick={async () =>
                    (await confirm({
                      title: 'Remove admin?',
                      body: <p>{a.user_id === me.user_id ? 'You will lose access to the admin board.' : `${a.email} will lose access to the admin board.`}</p>,
                      confirm: 'Remove',
                      danger: true,
                    })) && del.mutate(a.user_id)
                  }
                >
                  <Icon name="delete" size={16} />
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      </section>
      <section className="card p-4">
        <h2 className="font-semibold">Invite someone</h2>
        <p className="text-sm text-stone-600">They get an email from Supabase with a link to set their password. If they already have an account, they are simply added.</p>
        <form
          className="mt-3 flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (validEmail(email)) invite.mutate();
          }}
        >
          <label className="sr-only" htmlFor="invite-email">
            Email
          </label>
          <input
            id="invite-email"
            type="email"
            className="input h-10 min-w-0 basis-full py-0 sm:max-w-xs sm:basis-auto sm:flex-1"
            placeholder="email@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <label className="sr-only" htmlFor="invite-role">
            Role
          </label>
          <select id="invite-role" className="input h-10 w-auto flex-1 py-0 text-sm sm:flex-none" value={role} onChange={(e) => setRole(e.target.value as 'owner' | 'staff')}>
            <option value="staff">Staff</option>
            <option value="owner">Owner</option>
          </select>
          <button className="btn-primary flex-1 sm:flex-none" disabled={!validEmail(email) || invite.isPending}>
            <Icon name="mail" size={16} />
            {invite.isPending ? 'Sending…' : 'Send invite'}
          </button>
        </form>
      </section>
    </div>
  );
}
