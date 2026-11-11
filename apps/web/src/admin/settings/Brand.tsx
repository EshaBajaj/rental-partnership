// Brand & trust: who respondents are talking to (shown subtly on every step), contact details,
// welcome text, speech language, logo and shop photo (public 'brand' bucket, resized client-side).
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { formatPhone, normalisePhone } from '@shared/phone.ts';
import { errMsg, must, qk, supabase } from '../api.ts';
import { useAdmin } from '../context.tsx';
import type { PropertyRow } from '../types.ts';
import { useToast } from '../ui.tsx';
import { ACCEPTED, shrinkImage } from './image.ts';

type BrandFields = Pick<PropertyRow, 'brand_name' | 'contact_phone' | 'contact_whatsapp' | 'address_line' | 'welcome_title_en' | 'welcome_title_hi' | 'welcome_body_en' | 'welcome_body_hi' | 'default_speech_lang'>;

const pick = (p: PropertyRow): BrandFields => ({
  brand_name: p.brand_name,
  contact_phone: p.contact_phone,
  contact_whatsapp: p.contact_whatsapp,
  address_line: p.address_line,
  welcome_title_en: p.welcome_title_en,
  welcome_title_hi: p.welcome_title_hi,
  welcome_body_en: p.welcome_body_en,
  welcome_body_hi: p.welcome_body_hi,
  default_speech_lang: p.default_speech_lang,
});

/** Phone typed by the admin → E.164 or null (empty). `false` = invalid. */
export function phoneField(s: string): string | null | false {
  if (!s.trim()) return null;
  return normalisePhone(s) ?? false;
}

export function BrandSettings() {
  const { property } = useAdmin();
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState<BrandFields>(pick(property));
  const [phone, setPhone] = useState(property.contact_phone ? formatPhone(property.contact_phone) : '');
  const [wa, setWa] = useState(property.contact_whatsapp ? formatPhone(property.contact_whatsapp) : '');
  useEffect(() => {
    setF(pick(property));
    setPhone(property.contact_phone ? formatPhone(property.contact_phone) : '');
    setWa(property.contact_whatsapp ? formatPhone(property.contact_whatsapp) : '');
  }, [property]);
  const phoneN = phoneField(phone);
  const waN = phoneField(wa);
  const next: BrandFields = { ...f, contact_phone: phoneN === false ? f.contact_phone : phoneN, contact_whatsapp: waN === false ? f.contact_whatsapp : waN };
  const dirty = JSON.stringify(next) !== JSON.stringify(pick(property)) || phoneN === false || waN === false;
  const invalid = phoneN === false || waN === false || !f.brand_name.trim();

  const save = useMutation({
    mutationFn: async (patch: Partial<PropertyRow>) => must(await supabase.from('properties').update(patch).eq('id', property.id).select('*').single()),
    onSuccess: () => {
      toast('Saved', 'success');
      qc.invalidateQueries({ queryKey: qk.properties });
    },
    onError: (e) => toast(errMsg(e), 'error'),
  });

  const text = (k: keyof BrandFields, label: string, max: number, multiline = false, hint?: string) => (
    <div className={multiline ? 'sm:col-span-2' : ''}>
      <label className="label" htmlFor={`b-${k}`}>
        {label}
      </label>
      {multiline ? (
        <textarea id={`b-${k}`} className="input min-h-16" maxLength={max} value={(f[k] as string | null) ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value || null })} />
      ) : (
        <input id={`b-${k}`} className="input" maxLength={max} value={(f[k] as string | null) ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value || null })} />
      )}
      {hint && <p className="mt-1 text-xs text-stone-500">{hint}</p>}
    </div>
  );

  return (
    <section className="card space-y-4 p-4">
      <div>
        <p className="text-sm text-stone-600">
          Shown quietly to respondents so they know who they are talking to: “Your answers go only to {f.brand_name || '…'}”, the number you will call from, and your shop photo.
        </p>
      </div>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!invalid) save.mutate({ ...next, brand_name: f.brand_name.trim() });
        }}
      >
        <div>
          <label className="label" htmlFor="b-brand_name">
            Business name
          </label>
          <input id="b-brand_name" className="input" required maxLength={80} value={f.brand_name} onChange={(e) => setF({ ...f, brand_name: e.target.value })} />
        </div>
        {text('address_line', 'Address (one line)', 200)}
        <div>
          <label className="label" htmlFor="b-phone">
            We will call from (phone)
          </label>
          <input id="b-phone" type="tel" className={`input ${phoneN === false ? 'border-red-400' : ''}`} value={phone} placeholder="98765 43210" aria-invalid={phoneN === false} onChange={(e) => setPhone(e.target.value)} />
          {phoneN === false ? <p className="mt-1 text-xs text-red-700">Not a valid phone number.</p> : phoneN && <p className="mt-1 text-xs text-stone-500">Saved as {phoneN}</p>}
        </div>
        <div>
          <label className="label" htmlFor="b-wa">
            WhatsApp number (for questions and deletion requests)
          </label>
          <input id="b-wa" type="tel" className={`input ${waN === false ? 'border-red-400' : ''}`} value={wa} placeholder="98765 43210" aria-invalid={waN === false} onChange={(e) => setWa(e.target.value)} />
          {waN === false ? <p className="mt-1 text-xs text-red-700">Not a valid phone number.</p> : waN && <p className="mt-1 text-xs text-stone-500">Saved as {waN}</p>}
        </div>
        {text('welcome_title_en', 'Welcome title (English)', 120)}
        {text('welcome_title_hi', 'Welcome title (Hindi)', 120)}
        {text('welcome_body_en', 'Welcome text (English)', 500, true)}
        {text('welcome_body_hi', 'Welcome text (Hindi)', 500, true)}
        <div>
          <label className="label" htmlFor="b-speech">
            Language for live speech-to-text
          </label>
          <select id="b-speech" className="input" value={f.default_speech_lang} onChange={(e) => setF({ ...f, default_speech_lang: e.target.value as 'hi-IN' | 'en-IN' })}>
            <option value="hi-IN">Hindi (hi-IN) — also understands mixed Hindi/English</option>
            <option value="en-IN">English (India, en-IN)</option>
          </select>
          <p className="mt-1 text-xs text-stone-500">Used when the respondent has not picked a language. Respondents who switch to English or Hindi get that language.</p>
        </div>
        <div className="flex items-end gap-2 sm:col-span-2">
          <button className="btn-primary" disabled={!dirty || invalid || save.isPending}>
            Save
          </button>
          {dirty && (
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setF(pick(property));
                setPhone(property.contact_phone ? formatPhone(property.contact_phone) : '');
                setWa(property.contact_whatsapp ? formatPhone(property.contact_whatsapp) : '');
              }}
            >
              Reset
            </button>
          )}
        </div>
      </form>

      <div className="grid gap-4 sm:grid-cols-2">
        <ImagePicker field="logo_url" label="Logo" prefix="logo" />
        <ImagePicker field="shop_photo_url" label="Shop photo" prefix="shop" />
      </div>

      <div>
        <p className="label">How the welcome screen starts</p>
        <div className="mx-auto max-w-[360px] overflow-hidden rounded-2xl border border-stone-200 bg-bg">
          {property.shop_photo_url && <img src={property.shop_photo_url} alt="" className="h-40 w-full object-cover" />}
          <div className="space-y-2 p-4">
            <div className="flex items-center gap-2">
              {property.logo_url && <img src={property.logo_url} alt="" className="h-8 w-8 rounded-md object-contain" />}
              <span className="text-sm text-stone-600">{f.brand_name}</span>
            </div>
            <p className="text-lg font-semibold text-ink">{f.welcome_title_en || property.name}</p>
            {f.welcome_body_en && <p className="text-sm text-stone-600">{f.welcome_body_en}</p>}
            <p className="text-xs text-stone-500">About 2 minutes · No sign-up needed</p>
            <p className="text-xs text-stone-500">Your answers go only to {f.brand_name}. We'll call only about this shop.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function ImagePicker({ field, label, prefix }: { field: 'logo_url' | 'shop_photo_url'; label: string; prefix: 'logo' | 'shop' }) {
  const { property } = useAdmin();
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const current = property[field];

  async function setUrl(url: string | null) {
    must(await supabase.from('properties').update({ [field]: url }).eq('id', property.id).select('id').single());
    qc.invalidateQueries({ queryKey: qk.properties });
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const img = await shrinkImage(file);
      const path = `${property.id}/${prefix}-${Date.now()}.${img.ext}`;
      const up = await supabase.storage.from('brand').upload(path, img.blob, { contentType: img.type, upsert: false, cacheControl: '31536000' });
      if (up.error) throw up.error;
      await setUrl(supabase.storage.from('brand').getPublicUrl(path).data.publicUrl);
      toast(`${label} updated`, 'success');
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-stone-200 p-3">
      <p className="label">{label}</p>
      {current ? <img src={current} alt={label} className="mb-2 h-28 w-full rounded-lg object-contain bg-stone-50" /> : <p className="mb-2 text-sm text-stone-500">None yet.</p>}
      <div className="flex flex-wrap gap-2">
        <label className="btn-secondary btn-sm cursor-pointer">
          {busy ? 'Uploading…' : current ? 'Replace' : 'Upload'}
          <input type="file" accept={ACCEPTED.join(',')} className="sr-only" disabled={busy} onChange={(e) => void onFile(e.target.files?.[0])} />
        </label>
        {current && (
          <button className="btn-ghost btn-sm text-red-700" disabled={busy} onClick={() => void setUrl(null).then(() => toast(`${label} removed`, 'success'), (e) => toast(errMsg(e), 'error'))}>
            Remove
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-stone-500">JPG, PNG or WebP. We shrink it to 1200 px and under 1 MB before uploading.</p>
    </div>
  );
}
