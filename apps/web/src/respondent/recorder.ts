// MediaRecorder helpers.
import { VOICE_MIME_TYPES, type VoiceMime } from '@shared/types.ts';

const CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg', 'audio/mpeg', 'audio/wav'];

export function baseMime(m: string): VoiceMime | null {
  const b = m.split(';')[0].trim().toLowerCase();
  return (VOICE_MIME_TYPES as readonly string[]).includes(b) ? (b as VoiceMime) : null;
}

export function pickRecorderMime(isSupported: (m: string) => boolean): string | null {
  for (const c of CANDIDATES) {
    try {
      if (isSupported(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return null;
}

export function voiceSupported(): boolean {
  return typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
}

export interface Recording {
  blob: Blob;
  mime: VoiceMime;
  seconds: number;
}

/** Start recording; resolves `stop()` to the finished recording. Auto-stops at maxSeconds. */
export async function startRecording(maxSeconds: number, onTick: (s: number) => void): Promise<{ stop: () => Promise<Recording>; cancel: () => void }> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const mimePick = pickRecorderMime((m) => MediaRecorder.isTypeSupported(m));
  const rec = mimePick ? new MediaRecorder(stream, { mimeType: mimePick, audioBitsPerSecond: 24000 }) : new MediaRecorder(stream);
  const chunks: Blob[] = [];
  const started = performance.now();
  rec.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
  rec.start(1000);
  const tick = setInterval(() => {
    const s = (performance.now() - started) / 1000;
    onTick(s);
    if (s >= maxSeconds && rec.state === 'recording') rec.stop();
  }, 250);
  const done = new Promise<Recording>((resolve, reject) => {
    rec.onstop = () => {
      clearInterval(tick);
      stream.getTracks().forEach((t) => t.stop());
      const type = rec.mimeType || mimePick || 'audio/webm';
      const mime = baseMime(type);
      if (!mime) return reject(new Error(`Unsupported recording format ${type}`));
      resolve({ blob: new Blob(chunks, { type: mime }), mime, seconds: Math.min((performance.now() - started) / 1000, maxSeconds) });
    };
    rec.onerror = () => reject(new Error('Recording failed'));
  });
  return {
    stop: () => {
      if (rec.state === 'recording') rec.stop();
      return done;
    },
    cancel: () => {
      clearInterval(tick);
      if (rec.state === 'recording') rec.stop();
      stream.getTracks().forEach((t) => t.stop());
    },
  };
}
