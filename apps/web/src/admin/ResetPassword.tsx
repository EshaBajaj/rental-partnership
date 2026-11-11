// /admin/reset — set a password after following an invite or "forgot password" email link.
// Reachable without an admins row (new invitees set their password here first).
import { type FormEvent, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useNavigate } from 'react-router-dom';
import { errMsg, supabase } from './api.ts';
import { passwordProblem, validEmail } from './admins/lastOwner.ts';
import { Icon } from '../lib/icons.tsx';

function Msg({ msg }: { msg: { kind: 'error' | 'ok'; text: string } }) {
  const err = msg.kind === 'error';
  return (
    <p role={err ? 'alert' : 'status'} className={`flex gap-2 rounded-xl p-3 text-sm ${err ? 'bg-red-50 text-red-800' : 'bg-emerald-50 text-emerald-800'}`}>
      <Icon name={err ? 'alert' : 'ok'} size={18} className="mt-px" />
      <span className="min-w-0">{msg.text}</span>
    </p>
  );
}

export function ResetPassword({ session }: { session: Session | null }) {
  const nav = useNavigate();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    const problem = passwordProblem(pw, pw2);
    if (problem) return setMsg({ kind: 'error', text: problem });
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return setMsg({ kind: 'error', text: errMsg(error) });
    setMsg({ kind: 'ok', text: 'Password saved.' });
    setTimeout(() => nav('/admin', { replace: true }), 600);
  }

  async function resend(e: FormEvent) {
    e.preventDefault();
    if (!validEmail(email)) return setMsg({ kind: 'error', text: 'Enter the email you were invited with.' });
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${location.origin}/admin/reset` });
    setBusy(false);
    setMsg(error ? { kind: 'error', text: errMsg(error) } : { kind: 'ok', text: 'If that email has an account, a new link is on its way.' });
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-stone-100 p-4">
      {session ? (
        <form onSubmit={save} className="card w-full max-w-sm space-y-4 p-6">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-700 text-white">
              <Icon name="key" size={22} />
            </span>
            <div className="min-w-0">
              <h1 className="page-title">Set your password</h1>
              <p className="truncate text-sm text-stone-500">For {session.user.email}</p>
            </div>
          </div>
          <div>
            <label className="label" htmlFor="pw">
              New password (at least 8 characters)
            </label>
            <input id="pw" type="password" autoComplete="new-password" className="input" value={pw} onChange={(e) => setPw(e.target.value)} required minLength={8} />
          </div>
          <div>
            <label className="label" htmlFor="pw2">
              Type it again
            </label>
            <input id="pw2" type="password" autoComplete="new-password" className="input" value={pw2} onChange={(e) => setPw2(e.target.value)} required />
          </div>
          {msg && <Msg msg={msg} />}
          <button className="btn-primary w-full" disabled={busy}>
            {busy ? 'Saving…' : 'Save password'}
          </button>
        </form>
      ) : (
        <form onSubmit={resend} className="card w-full max-w-sm space-y-4 p-6">
          <div className="space-y-2">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-100 text-amber-800">
              <Icon name="alert" size={22} />
            </span>
            <h1 className="page-title">This link has expired</h1>
            <p className="text-sm text-stone-600">Links in invite and password emails work once and only for a short time. Enter your email to get a new one.</p>
          </div>
          <div>
            <label className="label" htmlFor="reset-email">
              Email
            </label>
            <input id="reset-email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          {msg && <Msg msg={msg} />}
          <button className="btn-primary w-full" disabled={busy}>
            <Icon name="mail" size={16} />
            Send a new link
          </button>
          <a className="btn-ghost w-full text-stone-600" href="/admin/login">
            <Icon name="back" size={16} />
            Back to sign in
          </a>
        </form>
      )}
    </div>
  );
}
