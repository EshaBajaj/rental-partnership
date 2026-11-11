// Quiet trust signals: who receives the answers, how they are used, and a plain-language privacy page.
import { Link } from 'react-router-dom';
import type { PublicProperty } from './api.ts';
import { type Lang, pick, t } from './i18n.ts';
import { Icon } from '../lib/icons.tsx';

export function LockIcon() {
  return <Icon name="lock" size={14} />;
}

/** Footer on every step: small, muted, never shouty. */
export function TrustFooter({ property, lang }: { property: PublicProperty; lang: Lang }) {
  return (
    <p className="mt-4 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-muted">
      <span className="inline-flex items-center gap-1">
        <LockIcon />
        {t(lang, 'sharedOnlyWith', { brand: property.brand_name })}
      </span>
      <span aria-hidden="true">·</span>
      <Link to={`/p/${property.slug}/privacy`} className="underline decoration-1 underline-offset-2">
        {t(lang, 'howWeUse')}
      </Link>
    </p>
  );
}

export function BrandMark({ property }: { property: PublicProperty }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      {property.logo_url && <img src={property.logo_url} alt="" className="h-7 w-7 shrink-0 rounded-md object-cover" />}
      <span className="truncate text-sm font-medium text-muted">{property.brand_name}</span>
    </div>
  );
}

export function LangToggle({ lang, onLang }: { lang: Lang; onLang: (l: Lang) => void }) {
  return (
    <button type="button" className="shrink-0 rounded-full border border-line px-3 py-1 text-sm text-ink" onClick={() => onLang(lang === 'en' ? 'hi' : 'en')}>
      {t(lang, 'language')}
    </button>
  );
}

export function Welcome({ property, lang, onLang, onStart }: { property: PublicProperty; lang: Lang; onLang: (l: Lang) => void; onStart: () => void }) {
  const title = pick(lang, property.welcome_title_en ?? property.name, property.welcome_title_hi);
  const body = pick(lang, property.welcome_body_en ?? '', property.welcome_body_hi);
  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col px-4 pb-6 pt-4">
      <header className="mb-4 flex items-center justify-between gap-2">
        <BrandMark property={property} />
        <LangToggle lang={lang} onLang={onLang} />
      </header>
      <main className="flex flex-1 flex-col">
        {property.shop_photo_url && (
          <img src={property.shop_photo_url} alt="" className="mb-6 aspect-[4/3] w-full rounded-xl border border-line object-cover" />
        )}
        <h1 className="text-3xl font-semibold leading-tight text-ink">{title}</h1>
        {property.address_line && <p className="mt-1 text-muted">{property.address_line}</p>}
        {body && <p className="mt-4 text-lg leading-relaxed text-ink">{body}</p>}
        <p className="mt-6 text-sm font-medium text-ink">{t(lang, 'welcomeMeta')}</p>
        <p className="mt-2 text-sm text-muted">{t(lang, 'welcomePromise', { brand: property.brand_name })}</p>
        <div className="flex-1" />
        <button type="button" className="r-btn-primary mt-8 w-full" onClick={onStart}>
          {t(lang, 'start')}
        </button>
        <TrustFooter property={property} lang={lang} />
      </main>
    </div>
  );
}

function waLink(e164: string, text: string) {
  return `https://wa.me/${e164.replace(/^\+/, '')}?text=${encodeURIComponent(text)}`;
}

export function DoneScreen({ property, lang, name, waitlist, onAgain }: { property: PublicProperty; lang: Lang; name: string; waitlist: boolean; onAgain: () => void }) {
  const first = name.split(' ')[0] || '';
  const phone = property.contact_phone ? property.contact_phone.replace(/^\+91(\d{5})(\d{5})$/, '+91 $1 $2') : null;
  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-4 py-8">
      <div className="r-card space-y-4 p-8 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary-soft text-success" aria-hidden="true">
          <Icon name="tick" size={28} />
        </div>
        <h1 className="text-2xl font-semibold text-ink">{t(lang, 'thanksTitle', { name: first }).replace(', !', '!')}</h1>
        <p className="text-lg text-ink">{waitlist ? t(lang, 'waitlistDone') : phone ? t(lang, 'doneCall', { brand: property.brand_name, phone }) : t(lang, 'doneCallNoPhone', { brand: property.brand_name })}</p>
        {property.contact_whatsapp && (
          <a className="r-btn-secondary w-full" href={waLink(property.contact_whatsapp, `Hi ${property.brand_name}, I filled the form for ${property.name}.`)} target="_blank" rel="noopener noreferrer">
            <Icon name="whatsapp" size={22} />
            {t(lang, 'whatsappUs')}
          </a>
        )}
        <button type="button" className="text-sm text-muted underline" onClick={onAgain}>
          {t(lang, 'startOver')}
        </button>
      </div>
      <TrustFooter property={property} lang={lang} />
    </div>
  );
}

/** Plain-language privacy page. Every statement here must match what the software does. */
export function PrivacyPage({ property, lang, onLang }: { property: PublicProperty; lang: Lang; onLang: (l: Lang) => void }) {
  const b = property.brand_name;
  const days = property.audio_retention_days;
  const wa = property.contact_whatsapp;
  const en = lang === 'en';
  const sections: Array<[string, string[]]> = en
    ? [
        ['What we collect', [
          'Your answers to the questions, your name and mobile number, and whether WhatsApp is OK.',
          'If you choose to speak: the recording (unless this question is set to keep text only) and the written text.',
          'How long the form took, and a scrambled code made from your internet address (not the address itself) to stop spam.',
          'While you fill the form, your answers are saved on this phone so nothing is lost if the connection drops. They are removed once sent.',
        ]],
        ['Who sees it', [
          `Only the ${b} team that manages this shop. We do not sell or share your details, and there are no ads or tracking scripts on this form.`,
          `When an enquiry looks like a good match, a short summary (name, number and answers) is sent to the ${b} team's private Telegram chat.`,
          'We count how many people open and finish the form (no cookies, no advertising) so we can keep it short.',
        ]],
        ['Voice answers', [
          "While you speak, your browser's own speech service turns your words into text live (in Chrome this is Google's service).",
          'Recordings are sent to Groq, a speech-to-text service, to write them down, and Hindi text is translated to English the same way so our team can read it.',
          'You always see and can edit the text before it is sent.',
        ]],
        ['Where it is stored and for how long', [
          'Your details are stored securely with our database provider, Supabase.',
          `Voice recordings are deleted automatically after ${days} days. The written text of your answers is kept until you ask us to delete it.`,
        ]],
        ['Delete your details', [
          wa ? `Send a WhatsApp message to ${wa} and we will delete your details.` : property.contact_phone ? `Call ${property.contact_phone} and we will delete your details.` : `Contact ${b} and we will delete your details.`,
        ]],
      ]
    : [
        ['हम क्या लेते हैं', [
          'प्रश्नों के आपके उत्तर, आपका नाम और मोबाइल नंबर, और क्या WhatsApp ठीक है।',
          'अगर आप बोलकर उत्तर देते हैं: रिकॉर्डिंग (जब तक प्रश्न सिर्फ़ लिखित टेक्स्ट रखने के लिए सेट न हो) और लिखा हुआ टेक्स्ट।',
          'फ़ॉर्म भरने में लगा समय, और स्पैम रोकने के लिए आपके इंटरनेट पते से बना एक बदला हुआ कोड (पता ख़ुद नहीं)।',
          'फ़ॉर्म भरते समय आपके उत्तर इसी फ़ोन में सेव रहते हैं ताकि कनेक्शन टूटने पर कुछ न खोए। भेजने के बाद हटा दिए जाते हैं।',
        ]],
        ['कौन देखता है', [
          `सिर्फ़ ${b} की टीम जो इस दुकान को संभालती है। हम आपकी जानकारी न बेचते हैं न साझा करते हैं, और इस फ़ॉर्म पर कोई विज्ञापन या ट्रैकिंग स्क्रिप्ट नहीं है।`,
          `जब कोई पूछताछ अच्छी लगती है, तो उसका छोटा सार (नाम, नंबर और उत्तर) ${b} टीम की निजी Telegram चैट में भेजा जाता है।`,
          'हम गिनते हैं कि कितने लोग फ़ॉर्म खोलते और पूरा करते हैं (कोई कुकी नहीं, कोई विज्ञापन नहीं) ताकि फ़ॉर्म छोटा रहे।',
        ]],
        ['बोलकर दिए उत्तर', [
          'जब आप बोलते हैं, आपके ब्राउज़र की अपनी स्पीच सेवा आपके शब्दों को तुरंत टेक्स्ट में बदलती है (Chrome में यह Google की सेवा है)।',
          'रिकॉर्डिंग लिखने के लिए Groq (स्पीच-टू-टेक्स्ट सेवा) को भेजी जाती हैं, और हिंदी टेक्स्ट का अंग्रेज़ी अनुवाद भी वहीं होता है ताकि हमारी टीम पढ़ सके।',
          'भेजने से पहले आप हमेशा टेक्स्ट देख और बदल सकते हैं।',
        ]],
        ['कहाँ और कब तक रखा जाता है', [
          'आपकी जानकारी हमारे डेटाबेस प्रदाता Supabase के पास सुरक्षित रखी जाती है।',
          `आवाज़ की रिकॉर्डिंग ${days} दिन बाद अपने-आप हटा दी जाती हैं। आपके उत्तरों का लिखा हुआ टेक्स्ट तब तक रखा जाता है जब तक आप हटाने को न कहें।`,
        ]],
        ['अपनी जानकारी हटवाएँ', [
          wa ? `${wa} पर WhatsApp संदेश भेजें, हम आपकी जानकारी हटा देंगे।` : property.contact_phone ? `${property.contact_phone} पर कॉल करें, हम आपकी जानकारी हटा देंगे।` : `${b} से संपर्क करें, हम आपकी जानकारी हटा देंगे।`,
        ]],
      ];
  return (
    <div className="mx-auto max-w-lg px-4 pb-10 pt-4">
      <header className="mb-6 flex items-center justify-between gap-2">
        <BrandMark property={property} />
        <LangToggle lang={lang} onLang={onLang} />
      </header>
      <h1 className="text-2xl font-semibold text-ink">{en ? 'How we use your details' : 'हम आपकी जानकारी कैसे इस्तेमाल करते हैं'}</h1>
      <p className="mt-2 text-muted">{property.name}{property.address_line ? ` · ${property.address_line}` : ''}</p>
      {sections.map(([h, items]) => (
        <section key={h} className="mt-6">
          <h2 className="text-lg font-semibold text-ink">{h}</h2>
          <ul className="mt-2 list-disc space-y-2 pl-5 text-ink">
            {items.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </section>
      ))}
      <Link to={`/f/${property.slug}`} className="r-btn-secondary mt-8 w-full">
        {t(lang, 'back2form')}
      </Link>
    </div>
  );
}
