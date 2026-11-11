// Groq speech-to-text (whisper-large-v3) and text translation (chat model with fallbacks).
import { type Speech, type TranscribeResult, UpstreamError } from './deps.ts';

const BASE = 'https://api.groq.com/openai/v1';
export const WHISPER_MODEL = 'whisper-large-v3';
export const WHISPER_PROMPT = 'dukaan, kiraya, rent, lease, deposit, partnership, investment, lakh, hazaar';
/** Preferred first; later entries are used if Groq reports the model as unavailable. */
export const DEFAULT_TRANSLATE_MODELS = ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile', 'openai/gpt-oss-20b'];

async function upstream(res: Response): Promise<never> {
  let msg = `Groq HTTP ${res.status}`;
  try {
    const b = await res.json();
    msg = b?.error?.message ?? msg;
  } catch { /* ignore */ }
  const ra = Number(res.headers.get('retry-after'));
  throw new UpstreamError(res.status, msg, Number.isFinite(ra) && ra > 0 ? ra : null);
}

function wrapNetwork(e: unknown): never {
  if (e instanceof UpstreamError) throw e;
  if (e instanceof DOMException && (e.name === 'AbortError' || e.name === 'TimeoutError')) throw new UpstreamError(408, 'Groq request timed out');
  throw new UpstreamError(0, `Network error: ${(e as Error)?.message ?? e}`);
}

export function createGroq(apiKey: string, translateModels = DEFAULT_TRANSLATE_MODELS, fetchFn: typeof fetch = fetch): Speech {
  const auth = { Authorization: `Bearer ${apiKey}` };
  return {
    async transcribe(audio: Blob, filename: string, signal: AbortSignal): Promise<TranscribeResult> {
      if (!apiKey) throw new UpstreamError(503, 'GROQ_API_KEY is not set');
      const form = new FormData();
      form.append('file', audio, filename);
      form.append('model', WHISPER_MODEL);
      form.append('response_format', 'verbose_json');
      form.append('temperature', '0');
      form.append('prompt', WHISPER_PROMPT);
      try {
        const res = await fetchFn(`${BASE}/audio/transcriptions`, { method: 'POST', headers: auth, body: form, signal });
        if (!res.ok) await upstream(res);
        const b = await res.json();
        return { text: String(b.text ?? '').trim(), language: b.language ?? null, duration: typeof b.duration === 'number' ? b.duration : null };
      } catch (e) {
        wrapNetwork(e);
      }
    },

    async translateToEnglish(text: string, signal: AbortSignal): Promise<string> {
      if (!apiKey) throw new UpstreamError(503, 'GROQ_API_KEY is not set');
      let lastErr: unknown = null;
      for (const model of translateModels) {
        try {
          const res = await fetchFn(`${BASE}/chat/completions`, {
            method: 'POST',
            headers: { ...auth, 'Content-Type': 'application/json' },
            signal,
            body: JSON.stringify({
              model,
              temperature: 0,
              max_tokens: 1024,
              messages: [
                {
                  role: 'system',
                  content:
                    'Translate the user text (Hindi, Hinglish or another Indian language, about renting or partnering in a shop) into plain English. ' +
                    'Keep numbers, amounts (lakh, hazaar → keep and add rupee figures in brackets), names and places. Output only the translation.',
                },
                { role: 'user', content: text },
              ],
            }),
          });
          if (res.status === 404 || res.status === 400) {
            const b = await res.json().catch(() => ({}));
            const code = String(b?.error?.code ?? '');
            if (res.status === 404 || code.includes('model') || String(b?.error?.message ?? '').includes('model')) {
              lastErr = new UpstreamError(res.status, `model ${model} unavailable`);
              continue; // try next model
            }
            throw new UpstreamError(res.status, b?.error?.message ?? 'Groq rejected the request');
          }
          if (!res.ok) await upstream(res);
          const b = await res.json();
          return String(b?.choices?.[0]?.message?.content ?? '').trim();
        } catch (e) {
          if (e instanceof UpstreamError) throw e;
          wrapNetwork(e);
        }
      }
      throw lastErr ?? new UpstreamError(503, 'No translation model available');
    },

    async listModels(signal: AbortSignal): Promise<string[]> {
      try {
        const res = await fetchFn(`${BASE}/models`, { headers: auth, signal });
        if (!res.ok) await upstream(res);
        const b = await res.json();
        return (b?.data ?? []).map((m: { id: string }) => m.id);
      } catch (e) {
        wrapNetwork(e);
      }
    },
  };
}
