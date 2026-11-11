import { type FormEvent, useState } from 'react';
import { supabase } from './api.ts';
import { errMsg } from './api.ts';

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
        <div>
          <h1 className="text-xl font-semibold">Shop Lead Screener</h1>
          <p className="text-sm text-stone-500">Admin sign in</p>
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
          <p className="text-sm text-red-700" role="alert">
            {error}
          </p>
        )}
        {resetSent && (
          <p role="status" className="text-sm text-emerald-700">
            If {email.trim()} has an account, we sent a link to set a new password. It works once and expires soon — check spam too.
          </p>
        )}
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <button type="button" className="w-full text-center text-sm text-stone-500 underline" onClick={reset}>
          Forgot password
        </button>
      </form>
    </div>
  );
}
