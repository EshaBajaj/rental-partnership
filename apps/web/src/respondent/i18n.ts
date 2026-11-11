export type Lang = 'en' | 'hi';

const S = {
  next: { en: 'Next', hi: 'आगे' },
  back: { en: 'Back', hi: 'पीछे' },
  send: { en: 'Send', hi: 'भेजें' },
  sending: { en: 'Sending…', hi: 'भेजा जा रहा है…' },
  optional: { en: 'Optional', hi: 'वैकल्पिक' },
  skip: { en: 'Skip', hi: 'छोड़ें' },
  step: { en: 'Question {n} of {t}', hi: 'प्रश्न {n} / {t}' },
  about2min: { en: 'Takes about 2 minutes', hi: 'लगभग 2 मिनट लगेंगे' },
  other: { en: 'Other', hi: 'अन्य' },
  otherPlaceholder: { en: 'Type your answer', hi: 'अपना उत्तर लिखें' },
  pickAll: { en: 'Pick all that apply', hi: 'जो भी लागू हों, सब चुनें' },
  choose: { en: 'Choose…', hi: 'चुनें…' },
  amountHint: { en: 'Enter the amount in rupees', hi: 'रकम रुपये में लिखें' },
  name: { en: 'Your name', hi: 'आपका नाम' },
  phone: { en: 'Mobile number', hi: 'मोबाइल नंबर' },
  whatsapp: { en: 'You can message me on WhatsApp', hi: 'आप मुझे WhatsApp पर संदेश भेज सकते हैं' },
  consent: { en: 'I agree to be contacted about this shop', hi: 'मैं इस दुकान के बारे में संपर्क किए जाने के लिए सहमत हूँ' },
  // voice
  speak: { en: 'Tap to speak', hi: 'बोलने के लिए दबाएँ' },
  orType: { en: 'or type your answer', hi: 'या अपना उत्तर लिखें' },
  recording: { en: 'Recording… tap to stop', hi: 'रिकॉर्ड हो रहा है… रोकने के लिए दबाएँ' },
  uploading: { en: 'Saving your recording…', hi: 'आपकी रिकॉर्डिंग सेव हो रही है…' },
  transcribing: { en: 'Writing down what you said…', hi: 'आपकी बात लिखी जा रही है…' },
  reviewTranscript: { en: 'Check what we heard. You can edit it.', hi: 'जाँच लें कि हमने क्या सुना। आप इसे बदल सकते हैं।' },
  pending: {
    en: 'Your recording is saved. The text will be ready later — you can type a short summary or just continue.',
    hi: 'आपकी रिकॉर्डिंग सेव हो गई है। लिखित रूप बाद में तैयार होगा — आप छोटा सार लिख सकते हैं या आगे बढ़ सकते हैं।',
  },
  rerecord: { en: 'Record again', hi: 'फिर से रिकॉर्ड करें' },
  recordingsLeft: { en: '{n} left', hi: '{n} बाकी' },
  deleteRecording: { en: 'Remove recording', hi: 'रिकॉर्डिंग हटाएँ' },
  micDenied: {
    en: 'Microphone is blocked. Allow it in your browser settings, or type your answer.',
    hi: 'माइक्रोफ़ोन बंद है। ब्राउज़र सेटिंग में इसकी अनुमति दें, या अपना उत्तर लिखें।',
  },
  micUnsupported: { en: 'Voice recording is not supported on this browser. Please type.', hi: 'इस ब्राउज़र में आवाज़ रिकॉर्डिंग नहीं होती। कृपया लिखें।' },
  uploadFailed: { en: 'Could not save the recording. Check your internet and try again.', hi: 'रिकॉर्डिंग सेव नहीं हुई। इंटरनेट जाँचें और फिर कोशिश करें।' },
  retry: { en: 'Try again', hi: 'फिर कोशिश करें' },
  tooShort: { en: 'That was very short — please try again.', hi: 'रिकॉर्डिंग बहुत छोटी थी — फिर से कोशिश करें।' },
  maxLength: { en: 'Max {s} seconds', hi: 'अधिकतम {s} सेकंड' },
  // states
  loading: { en: 'Loading…', hi: 'लोड हो रहा है…' },
  loadError: { en: 'Could not load the form. Check your internet and try again.', hi: 'फ़ॉर्म लोड नहीं हुआ। इंटरनेट जाँचें और फिर कोशिश करें।' },
  notFound: { en: 'This form does not exist.', hi: 'यह फ़ॉर्म मौजूद नहीं है।' },
  thanksTitle: { en: 'Thank you, {name}!', hi: 'धन्यवाद, {name}!' },
  thanksBody: { en: 'We have your details and will contact you soon.', hi: 'हमें आपकी जानकारी मिल गई है। हम जल्द ही आपसे संपर्क करेंगे।' },
  thanksWhatsapp: { en: 'We will message you on WhatsApp.', hi: 'हम आपको WhatsApp पर संदेश भेजेंगे।' },
  offlineSaved: {
    en: 'No internet. Your answers are saved on this phone and will be sent automatically when you are back online.',
    hi: 'इंटरनेट नहीं है। आपके उत्तर इस फ़ोन में सेव हैं और इंटरनेट आने पर अपने-आप भेज दिए जाएँगे।',
  },
  sendNow: { en: 'Send now', hi: 'अभी भेजें' },
  formChanged: { en: 'The form was updated. Please check your answers.', hi: 'फ़ॉर्म बदल गया है। कृपया अपने उत्तर जाँचें।' },
  tooMany: { en: 'Too many attempts. Please wait a few minutes and try again.', hi: 'बहुत ज़्यादा कोशिशें। कुछ मिनट रुककर फिर कोशिश करें।' },
  resumed: { en: 'Welcome back — we kept your answers.', hi: 'फिर से स्वागत है — आपके उत्तर सेव हैं।' },
  startOver: { en: 'Start over', hi: 'फिर से शुरू करें' },
  closedTitle: { en: 'Not available right now', hi: 'अभी उपलब्ध नहीं' },
  waitlistCta: { en: 'Tell me about the next shop', hi: 'अगली दुकान के बारे में बताएँ' },
  waitlistDone: { en: 'You are on the list. We will contact you.', hi: 'आप सूची में हैं। हम आपसे संपर्क करेंगे।' },
  language: { en: 'हिंदी', hi: 'English' },
  // input modes
  typeInstead: { en: 'Type instead', hi: 'इसके बजाय लिखें' },
  speakInstead: { en: 'Speak instead', hi: 'इसके बजाय बोलें' },
  chooseInstead: { en: 'Choose from options', hi: 'विकल्पों में से चुनें' },
  spokenAnswerAbove: { en: 'Your spoken answer is shown above — you can edit it there.', hi: 'आपका बोला हुआ उत्तर ऊपर है — वहीं बदल सकते हैं।' },
  charsLeft: { en: '{n} / {max}', hi: '{n} / {max}' },
  // live speaking
  listening: { en: 'Listening… start speaking', hi: 'सुन रहे हैं… बोलना शुरू करें' },
  recordingNoLive: { en: 'Recording… your words will be written down when you stop', hi: 'रिकॉर्ड हो रहा है… रोकने पर आपकी बात लिखी जाएगी' },
  speakingIn: { en: 'Speaking in:', hi: 'भाषा:' },
  stopRecording: { en: 'Stop recording', hi: 'रिकॉर्डिंग रोकें' },
  exactlyWhatWeReceive: { en: "This is exactly what we'll receive. Fix anything.", hi: 'हमें बिल्कुल यही मिलेगा। कुछ भी ठीक कर लें।' },
  audioMissingKept: { en: "We couldn't keep the recording, but your words above are saved.", hi: 'रिकॉर्डिंग नहीं रखी जा सकी, पर ऊपर लिखे आपके शब्द सेव हैं।' },
  clearerVersion: { en: 'We have a clearer version:', hi: 'हमारे पास एक साफ़ संस्करण है:' },
  useIt: { en: 'Use it', hi: 'इसे लें' },
  keepMine: { en: 'Keep mine', hi: 'मेरा ही रखें' },
  uploadFailedKeepText: { en: 'The recording could not be saved, but your words above will be sent.', hi: 'रिकॉर्डिंग सेव नहीं हुई, पर ऊपर लिखे आपके शब्द भेजे जाएँगे।' },
  // trust & brand
  start: { en: 'Start', hi: 'शुरू करें' },
  welcomeMeta: { en: 'About 2 minutes · No sign-up needed', hi: 'लगभग 2 मिनट · कोई साइन-अप नहीं' },
  welcomePromise: { en: "Your answers go only to {brand}. We'll call only about this shop.", hi: 'आपके उत्तर सिर्फ़ {brand} को जाते हैं। हम सिर्फ़ इस दुकान के बारे में ही कॉल करेंगे।' },
  sharedOnlyWith: { en: 'Shared only with {brand}', hi: 'सिर्फ़ {brand} के साथ साझा' },
  howWeUse: { en: 'How we use your details', hi: 'हम आपकी जानकारी कैसे इस्तेमाल करते हैं' },
  contactHelper: { en: 'So we can call you back about the shop. No marketing, ever.', hi: 'ताकि हम दुकान के बारे में आपको वापस कॉल कर सकें। कभी कोई मार्केटिंग नहीं।' },
  doneCall: { en: 'Someone from {brand} will call you from {phone}.', hi: '{brand} से कोई आपको {phone} से कॉल करेगा।' },
  doneCallNoPhone: { en: 'Someone from {brand} will call you soon.', hi: '{brand} से कोई जल्द ही आपको कॉल करेगा।' },
  whatsappUs: { en: 'Message us on WhatsApp', hi: 'WhatsApp पर संदेश भेजें' },
  back2form: { en: 'Back to the form', hi: 'फ़ॉर्म पर वापस' },
} as const;

export type StringKey = keyof typeof S;

export function t(lang: Lang, key: StringKey, vars: Record<string, string | number> = {}): string {
  let s: string = S[key][lang];
  for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  return s;
}

export function pick(lang: Lang, en: string, hi: string | null | undefined): string {
  return lang === 'hi' && hi ? hi : en;
}
