// GET /health → {ok}. With Bearer CRON_SECRET: detailed checks (cron heartbeat, worker, stuck
// recordings, failed notifications; ?deep=1 also verifies the Groq models). 503 when unhealthy.
import { bearer, json, safeEqual, serve } from '../_shared/server/http.ts';
import type { Deps } from '../_shared/server/deps.ts';
import { WHISPER_MODEL } from '../_shared/server/groq.ts';

interface Snapshot {
  now: string;
  last_heartbeat: string | null;
  last_worker_run: string | null;
  voice_pending: number;
  voice_stuck: number;
  voice_failed: number;
  notify_pending: number;
  notify_failed: number;
  responses_24h: number;
}

export function makeHandler(deps: Deps) {
  return serve(['GET'], deps.env.allowedOrigins, async (req) => {
    const s = await deps.db.rpc<Snapshot>('health_snapshot');
    const tok = bearer(req);
    const detailed = !!tok && deps.env.cronSecret.length >= 16 && safeEqual(tok, deps.env.cronSecret);
    const age = (t: string | null) => (t ? (deps.now() - Date.parse(t)) / 60_000 : Infinity);
    const checks: Record<string, { ok: boolean; detail: string }> = {
      database: { ok: true, detail: 'reachable' },
      pg_cron: { ok: age(s.last_heartbeat) < 15, detail: `last heartbeat ${s.last_heartbeat ?? 'never'}` },
      worker: { ok: age(s.last_worker_run) < 10, detail: `last run ${s.last_worker_run ?? 'never'}` },
      voice: { ok: s.voice_stuck === 0, detail: `${s.voice_pending} pending, ${s.voice_stuck} stuck > 1h, ${s.voice_failed} failed` },
      notifications: { ok: s.notify_failed === 0, detail: `${s.notify_pending} pending, ${s.notify_failed} failed` },
    };
    if (detailed && new URL(req.url).searchParams.get('deep') === '1') {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 8000);
      try {
        const models = await deps.speech.listModels(ctl.signal);
        const translate = (Deno.env.get('GROQ_TRANSLATE_MODELS') ?? 'llama-3.1-8b-instant').split(',')[0].trim();
        checks.groq = {
          ok: models.includes(WHISPER_MODEL) && models.includes(translate),
          detail: `${WHISPER_MODEL}: ${models.includes(WHISPER_MODEL) ? 'available' : 'MISSING'}; ${translate}: ${models.includes(translate) ? 'available' : 'MISSING (fallback models will be tried)'}`,
        };
      } catch (e) {
        checks.groq = { ok: false, detail: (e as Error).message };
      } finally {
        clearTimeout(timer);
      }
    }
    const ok = Object.values(checks).every((c) => c.ok);
    if (!detailed) return json({ ok }, ok ? 200 : 503);
    return json({ ok, checks, snapshot: s }, ok ? 200 : 503);
  });
}
