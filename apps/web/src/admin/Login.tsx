import { type FormEvent, useState } from 'react';
import { supabase } from './api.ts';
import { errMsg } from './api.ts';
import { Icon } from '../lib/icons.tsx';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setError(/invalid/i.test(error.message) ? 'Wrong email or password.' : errMsg(error));
  }

  async function reset() {
    if (!email.trim()) {
      setError('Enter your email first, then tap “Forgot password”.');
      return;
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${location.origin}/admin/reset` });
    if (error) setError(errMsg(error));
    else setResetSent(true);
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-stone-100 p-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4 p-6">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-700 text-white">
            <Icon name="lock" size={22} />
          </span>
          <div>
            <h1 className="page-title">Shop Lead Screener</h1>
            <p className="text-sm text-stone-500">Admin sign in</p>
          </div>
        </div>
        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input id="email" type="email" autoComplete="username" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div>
          <label className="label" htmlFor="password">
            Password
          </label>
          <input id="password" type="password" autoComplete="current-password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {error && (
          <p className="flex gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-800" role="alert">
            <Icon name="alert" size={18} className="mt-px" />
            <span className="min-w-0">{error}</span>
          </p>
        )}
        {resetSent && (
          <p role="status" className="flex gap-2 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">
            <Icon name="mail" size={18} className="mt-px" />
            <span className="min-w-0">If {email.trim()} has an account, we sent a link to set a new password. It works once and expires soon — check spam too.</span>
          </p>
        )}
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <button type="button" className="btn-ghost w-full text-stone-600" onClick={reset}>
          <Icon name="key" size={16} />
          Forgot password
        </button>
      </form>
    </div>
  );
}
