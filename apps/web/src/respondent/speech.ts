// Pure helpers for the speaking flow (unit-tested in test/respondent/speech.test.ts).

/** Lowercase, drop punctuation, collapse whitespace (works for Devanagari too). */
export function normalizeForCompare(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFC')
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Levenshtein distance on code points (two-row DP, O(n·m) time, O(m) memory). */
export function levenshtein(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  if (!x.length) return y.length;
  if (!y.length) return x.length;
  let prev = Array.from({ length: y.length + 1 }, (_, i) => i);
  let cur = new Array<number>(y.length + 1);
  for (let i = 1; i <= x.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= y.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    [prev, cur] = [cur, prev];
  }
  return prev[y.length];
}

/** 0 = identical, 1 = completely different (normalised by the longer text). */
export function textDifference(a: string, b: string): number {
  const x = normalizeForCompare(a);
  const y = normalizeForCompare(b);
  const max = Math.max([...x].length, [...y].length);
  return max === 0 ? 0 : levenshtein(x, y) / max;
}

/** Offer the Whisper version only when it differs by more than 15% and the respondent has not edited. */
export function shouldOfferClearerVersion(live: string, whisper: string, edited: boolean): boolean {
  if (edited || !whisper.trim()) return false;
  if (!live.trim()) return false; // nothing live: the Whisper text simply fills the box
  return textDifference(live, whisper) > 0.15;
}

/** In-app browsers (Instagram, Facebook, LINE, generic Android WebViews…) often break speech recognition. */
export function isInAppBrowser(ua: string): boolean {
  return /FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|Snapchat|; wv\)|WhatsApp/i.test(ua);
}

type RecognitionCtor = new () => SpeechRecognitionLike;

export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives?: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart?: (() => void) | null;
}

export function getRecognitionCtor(w: unknown = typeof window !== 'undefined' ? window : undefined): RecognitionCtor | null {
  const win = w as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor; navigator?: { userAgent?: string } } | undefined;
  if (!win) return null;
  const ctor = win.SpeechRecognition ?? win.webkitSpeechRecognition ?? null;
  if (!ctor) return null;
  if (isInAppBrowser(win.navigator?.userAgent ?? '')) return null;
  return ctor;
}

/** Near-silent recording: less than ~1 KB per second of audio. */
export function isNearSilent(bytes: number, seconds: number): boolean {
  return bytes < 1024 * Math.max(seconds, 1);
}

/** Speech recognition language: respondent's choice, else the property's default. */
export function speechLangFor(choice: 'hi-IN' | 'en-IN' | null, propertyDefault: 'hi-IN' | 'en-IN' | undefined): 'hi-IN' | 'en-IN' {
  return choice ?? propertyDefault ?? 'hi-IN';
}

/** Combine finalised segments and the current interim words. */
export function joinTranscript(finals: string[], interim: string): { final: string; interim: string } {
  return { final: finals.join(' ').replace(/\s+/g, ' ').trim(), interim: interim.trim() };
}
