// Property settings, QR poster, Telegram test, admins (owner only).
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { FUNCTIONS_URL } from '../../lib/env.ts';
import { must, qk, rpc, supabase } from '../api.ts';
import { useAdmin } from '../context.tsx';
import type { AdminRow, PropertyRow } from '../types.ts';
import { Badge, download, ErrorBox, Modal, Spinner, useConfirm, useToast } from '../ui.tsx';

export default function Settings() {
  const { me } = useAdmin();
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Settings</h1>
      <PropertyForm />
      <QrPoster />
      <Telegram />
      <Password />
      {me.role === 'owner' ? <Admins /> : <p className="text-sm text-stone-500">Only the owner can manage admins.</p>}
    </div>
  );
}

function PropertyForm() {
  const { property } = useAdmin();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [f, setF] = useState<PropertyRow>(property);
  useEffect(() => setF(property), [property]);
  const dirty = JSON.stringify(f) !== JSON.stringify(property);
  const save = useMutation({
    mutationFn: async (patch: Partial<PropertyRow>) => must(await supabase.from('properties').update(patch).eq('id', property.id).select('*').single()),
    onSuccess: () => {
      toast('Saved', 'success');
      qc.invalidateQueries({ queryKey: qk.properties });
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });
  async function toggleStatus() {
    const next = property.status === 'open' ? 'closed' : 'open';
    const ok = await confirm({
      title: next === 'closed' ? 'Close the form?' : 'Open the form?',
      confirm: next === 'closed' ? 'Close form' : 'Open form',
      danger: next === 'closed',
      body:
        next === 'closed' ? (
          <p>People who scan the QR code will see your “closed” message and can leave their number for the waitlist. Existing leads are not affected.</p>
        ) : (
          <p>People can fill the questionnaire again.</p>
        ),
    });
    if (ok) save.mutate({ status: next });
  }
  return (
    <section className="card space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto font-semibold">Property</h2>
        <Badge tone={property.status === 'open' ? 'green' : 'red'}>Form {property.status}</Badge>
        <button className="btn-secondary px-3 py-1 text-sm" onClick={toggleStatus} disabled={save.isPending}>
          {property.status === 'open' ? 'Close form' : 'Open form'}
        </button>
      </div>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate({ name: f.name.trim(), closed_message: f.closed_message, default_lang: f.default_lang, audio_retention_days: f.audio_retention_days });
        }}
      >
        <div>
          <label className="label" htmlFor="p-name">
            Name
          </label>
          <input id="p-name" className="input" maxLength={120} required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </div>
        <div>
          <span className="label">Link</span>
          <code className="block truncate rounded-xl bg-stone-100 px-3 py-2.5 text-sm">/f/{property.slug}</code>
        </div>
        <div>
          <label className="label" htmlFor="p-lang">
            Default language
          </label>
          <select id="p-lang" className="input" value={f.default_lang} onChange={(e) => setF({ ...f, default_lang: e.target.value as 'en' | 'hi' })}>
            <option value="en">English</option>
            <option value="hi">हिंदी (Hindi)</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="p-ret">
            Keep voice recordings for (days)
          </label>
          <input
            id="p-ret"
            type="number"
            min={7}
            max={3650}
            className="input"
            value={f.audio_retention_days}
            onChange={(e) => setF({ ...f, audio_retention_days: Math.max(7, Math.min(3650, Number(e.target.value) || 7)) })}
          />
          <p className="mt-1 text-xs text-stone-500">After this, the audio file is deleted; the written transcripts stay.</p>
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="p-closed">
            Message when the form is closed
          </label>
          <textarea id="p-closed" className="input min-h-20" maxLength={1000} value={f.closed_message} onChange={(e) => setF({ ...f, closed_message: e.target.value })} />
        </div>
        <div className="flex gap-2 sm:col-span-2">
          <button className="btn-primary" disabled={!dirty || save.isPending}>
            Save
          </button>
          {dirty && (
            <button type="button" className="btn-ghost" onClick={() => setF(property)}>
              Reset
            </button>
          )}
        </div>
      </form>
    </section>
  );
}

function QrPoster() {
  const { property } = useAdmin();
  const url = `${location.origin}/f/${property.slug}?src=qr`;
  const [png, setPng] = useState<string | null>(null);
  const [poster, setPoster] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toDataURL(url, { width: 1024, margin: 2, errorCorrectionLevel: 'M' })
      .then(setPng)
      .catch((e: Error) => setErr(e.message));
  }, [url]);
  return (
    <section className="card p-4">
      <h2 className="font-semibold">QR code</h2>
      {err && <ErrorBox error={err} />}
      <div className="mt-2 flex flex-wrap items-center gap-4">
        {png ? <img src={png} alt={`QR code for ${url}`} className="h-40 w-40 rounded-lg border" /> : <Spinner label="Making QR…" />}
        <div className="space-y-2 text-sm">
          <p className="break-all text-stone-600">{url}</p>
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary" disabled={!png} onClick={() => png && downloadDataUrl(png, `qr-${property.slug}.png`)}>
              Download PNG
            </button>
            <button className="btn-secondary" onClick={() => setPoster(true)} disabled={!png}>
              Printable poster
            </button>
            <button
              className="btn-ghost"
              onClick={() => {
                void navigator.clipboard?.writeText(url);
              }}
            >
              Copy link
            </button>
          </div>
        </div>
      </div>
      {poster && png && <Poster png={png} name={property.name} onClose={() => setPoster(false)} />}
    </section>
  );
}

function downloadDataUrl(dataUrl: string, name: string) {
  const bin = atob(dataUrl.split(',')[1]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  download(name, bytes, 'image/png');
}

function Poster({ png, name, onClose }: { png: string; name: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  function print() {
    const w = window.open('', '_blank', 'width=800,height=1000');
    if (!w || !ref.current) return;
    w.document.write(
      `<!doctype html><html><head><title>${name}</title><style>body{font-family:system-ui,'Noto Sans Devanagari',sans-serif;text-align:center;padding:40px}h1{font-size:44px;margin:0 0 8px}h2{font-size:30px;margin:0 0 24px;font-weight:500}img{width:70%;max-width:520px}p{font-size:22px}</style></head><body>${ref.current.innerHTML}<script>window.onload=()=>{window.print()}<\/script></body></html>`,
    );
    w.document.close();
  }
  return (
    <Modal title="Poster preview" onClose={onClose} wide>
      <div ref={ref} className="space-y-3 rounded-xl border p-6 text-center">
        <h1 className="text-3xl font-bold">Shop available — Rent or Partner</h1>
        <h2 className="text-xl">दुकान उपलब्ध — किराये या साझेदारी के लिए</h2>
        <img src={png} alt="QR code" className="mx-auto w-64" />
        <p className="text-lg">Scan &amp; answer a few quick questions (2 min). You can speak your answers.</p>
        <p className="text-lg">स्कैन करें और कुछ आसान सवालों के जवाब दें (2 मिनट)। आप बोलकर भी जवाब दे सकते हैं।</p>
        <p className="text-sm text-stone-500">{name}</p>
      </div>
      <div className="mt-4 flex justify-end">
        <button className="btn-primary" onClick={print}>
          Print
        </button>
      </div>
    </Modal>
  );
}

function Telegram() {
  const { session } = useAdmin();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function test() {
    setBusy(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token ?? session.access_token;
      const res = await fetch(`${FUNCTIONS_URL}/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ kind: 'test' }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) throw new Error(body.message ?? `HTTP ${res.status}`);
      toast('Test message sent — check Telegram', 'success');
    } catch (e) {
      toast(`Telegram test failed: ${(e as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card flex flex-wrap items-center gap-3 p-4">
      <div className="flex-1">
        <h2 className="font-semibold">Telegram alerts</h2>
        <p className="text-sm text-stone-600">Every “Ideal” lead is sent to your Telegram chat within seconds. Failed alerts are retried and shown on the lead.</p>
      </div>
      <button className="btn-secondary" disabled={busy} onClick={test}>
        {busy ? 'Sending…' : 'Send test message'}
      </button>
    </section>
  );
}

function Password() {
  const toast = useToast();
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <section className="card p-4">
      <h2 className="font-semibold">Change my password</h2>
      <form
        className="mt-2 flex flex-wrap gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const { error } = await supabase.auth.updateUser({ password: pw });
          setBusy(false);
          if (error) toast(error.message, 'error');
          else {
            setPw('');
            toast('Password changed', 'success');
          }
        }}
      >
        <label className="sr-only" htmlFor="newpw">
          New password
        </label>
        <input id="newpw" type="password" autoComplete="new-password" minLength={10} className="input max-w-xs" placeholder="New password (10+ characters)" value={pw} onChange={(e) => setPw(e.target.value)} />
        <button className="btn-secondary" disabled={busy || pw.length < 10}>
          Change
        </button>
      </form>
    </section>
  );
}

function Admins() {
  const { me } = useAdmin();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'staff' | 'owner'>('staff');
  const admins = useQuery({
    queryKey: qk.admins,
    queryFn: async () => must(await supabase.from('admins').select('*').order('created_at')) as AdminRow[],
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: qk.admins });
    qc.invalidateQueries({ queryKey: ['admin-emails'] });
  };
  const add = useMutation({
    mutationFn: () => rpc('add_admin', { p_email: email.trim(), p_role: role }),
    onSuccess: () => {
      toast('Admin added', 'success');
      setEmail('');
      refresh();
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });
  const setRoleM = useMutation({
    mutationFn: async ({ id, r }: { id: string; r: 'owner' | 'staff' }) => must(await supabase.from('admins').update({ role: r }).eq('user_id', id).select('user_id')),
    onSuccess: refresh,
    onError: (e) => toast((e as Error).message, 'error'),
  });
  const del = useMutation({
    mutationFn: async (id: string) => must(await supabase.from('admins').delete().eq('user_id', id).select('user_id')),
    onSuccess: refresh,
    onError: (e) => toast((e as Error).message, 'error'),
  });
  return (
    <section className="card p-4">
      <h2 className="font-semibold">Admins</h2>
      <p className="text-sm text-stone-600">
        Staff can do everything except manage admins. First create the person’s login in Supabase → Authentication → Users (“Invite user”), then add their email here.
      </p>
      {admins.isLoading ? (
        <Spinner />
      ) : (
        <ul className="mt-2 divide-y divide-stone-100">
          {(admins.data ?? []).map((a) => (
            <li key={a.user_id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <span className="flex-1">
                {a.email} {a.user_id === me.user_id && <Badge>you</Badge>}
              </span>
              <label className="sr-only" htmlFor={`role-${a.user_id}`}>
                Role
              </label>
              <select
                id={`role-${a.user_id}`}
                className="input w-auto py-1"
                value={a.role}
                disabled={a.user_id === me.user_id}
                onChange={(e) => setRoleM.mutate({ id: a.user_id, r: e.target.value as 'owner' | 'staff' })}
              >
                <option value="staff">Staff</option>
                <option value="owner">Owner</option>
              </select>
              {a.user_id !== me.user_id && (
                <button
                  className="btn-ghost px-2 py-1 text-red-700"
                  onClick={async () => (await confirm({ title: 'Remove admin?', body: <p>{a.email} will lose access to the admin board.</p>, confirm: 'Remove', danger: true })) && del.mutate(a.user_id)}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <form
        className="mt-3 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (email.trim()) add.mutate();
        }}
      >
        <label className="sr-only" htmlFor="new-admin">
          Email
        </label>
        <input id="new-admin" type="email" className="input max-w-xs" placeholder="email@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        <label className="sr-only" htmlFor="new-role">
          Role
        </label>
        <select id="new-role" className="input w-auto" value={role} onChange={(e) => setRole(e.target.value as 'staff' | 'owner')}>
          <option value="staff">Staff</option>
          <option value="owner">Owner</option>
        </select>
        <button className="btn-primary" disabled={add.isPending || !email.trim()}>
          Add admin
        </button>
      </form>
    </section>
  );
}
