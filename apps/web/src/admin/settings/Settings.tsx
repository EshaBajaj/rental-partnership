// Settings sub-pages (sidebar → Settings): property, brand & trust, QR poster, my account.
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { Navigate, useParams } from 'react-router-dom';
import { Icon } from '../../lib/icons.tsx';
import { must, qk, supabase } from '../api.ts';
import { useAdmin } from '../context.tsx';
import { passwordProblem } from '../admins/lastOwner.ts';
import type { PropertyRow } from '../types.ts';
import { Badge, download, ErrorBox, Modal, PageHeader, Spinner, useConfirm, useToast } from '../ui.tsx';
import { BrandSettings } from './Brand.tsx';
import { SETTINGS_SECTIONS } from './sections.ts';

export default function Settings() {
  const { section } = useParams();
  const current = SETTINGS_SECTIONS.find((x) => x.slug === section);
  if (!current) return <Navigate to="/admin/settings/property" replace />;
  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Settings" title={current.label} description={current.hint} />
      {current.slug === 'property' && <PropertyForm />}
      {current.slug === 'brand' && <BrandSettings />}
      {current.slug === 'qr' && <QrPoster />}
      {current.slug === 'account' && <Password />}
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
        <h2 className="mr-auto font-semibold">Form status</h2>
        <Badge tone={property.status === 'open' ? 'green' : 'red'}>Form {property.status}</Badge>
        <button className="btn-secondary btn-sm" onClick={toggleStatus} disabled={save.isPending}>
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
  const toast = useToast();
  useEffect(() => {
    QRCode.toDataURL(url, { width: 1024, margin: 2, errorCorrectionLevel: 'M' })
      .then(setPng)
      .catch((e: Error) => setErr(e.message));
  }, [url]);
  return (
    <section className="card p-4">
      {err && <ErrorBox error={err} />}
      <div className="mt-2 flex flex-wrap items-center gap-4">
        {png ? <img src={png} alt={`QR code for ${url}`} className="h-40 w-40 rounded-xl border border-stone-200" /> : <Spinner label="Making QR…" />}
        <div className="space-y-2 text-sm">
          <p className="break-all text-stone-600">{url}</p>
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary" disabled={!png} onClick={() => png && downloadDataUrl(png, `qr-${property.slug}.png`)}>
              <Icon name="download" />
              Download PNG
            </button>
            <button className="btn-secondary" onClick={() => setPoster(true)} disabled={!png}>
              <Icon name="qr" />
              Printable poster
            </button>
            <button
              className="btn-ghost"
              onClick={() => {
                void navigator.clipboard?.writeText(url).then(() => toast('Link copied', 'success'));
              }}
            >
              <Icon name="external" />
              Copy link
            </button>
          </div>
        </div>
      </div>
      {poster && png && <Poster png={png} name={property.name} brand={property.brand_name} onClose={() => setPoster(false)} />}
    </section>
  );
}

function downloadDataUrl(dataUrl: string, name: string) {
  const bin = atob(dataUrl.split(',')[1]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  download(name, bytes, 'image/png');
}

function Poster({ png, name, brand, onClose }: { png: string; name: string; brand: string; onClose: () => void }) {
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
        <p className="text-sm text-stone-500">
          {name} · {brand}
        </p>
      </div>
      <div className="mt-4 flex justify-end">
        <button className="btn-primary" onClick={print}>
          Print
        </button>
      </div>
    </Modal>
  );
}

function Password() {
  const toast = useToast();
  const { me } = useAdmin();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const problem = pw || pw2 ? passwordProblem(pw, pw2) : null;
  return (
    <section className="card max-w-lg space-y-4 p-4">
      <p className="text-sm text-stone-600">
        Signed in as <span className="font-medium text-stone-800">{me.email}</span> · {me.role}
      </p>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (passwordProblem(pw, pw2)) return;
          setBusy(true);
          const { error } = await supabase.auth.updateUser({ password: pw });
          setBusy(false);
          if (error) toast(error.message, 'error');
          else {
            setPw('');
            setPw2('');
            toast('Password changed', 'success');
          }
        }}
      >
        <div>
          <label className="label" htmlFor="newpw">
            New password (at least 8 characters)
          </label>
          <input id="newpw" type="password" autoComplete="new-password" minLength={8} className="input" value={pw} onChange={(e) => setPw(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="newpw2">
            Type it again
          </label>
          <input id="newpw2" type="password" autoComplete="new-password" className="input" value={pw2} onChange={(e) => setPw2(e.target.value)} />
        </div>
        {problem && pw2 && <p className="text-sm text-red-700">{problem}</p>}
        <button className="btn-primary" disabled={busy || !pw || !!passwordProblem(pw, pw2)}>
          <Icon name="key" />
          {busy ? 'Saving…' : 'Change password'}
        </button>
      </form>
    </section>
  );
}
