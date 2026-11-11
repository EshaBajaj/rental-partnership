// POST /notify → send pending Telegram notifications.
// Callers: pg_cron/worker (Bearer CRON_SECRET) or an admin ("Send test message").
import { bearer, HttpError, json, readJson, serve } from '../_shared/server/http.ts';
import type { Deps } from '../_shared/server/deps.ts';
import { processNotifications, requireInternal } from '../_shared/server/core.ts';
import { z } from 'zod';

const Body = z.object({ response_id: z.string().uuid().optional(), kind: z.enum(['pending', 'test']).default('pending') });

export function makeHandler(deps: Deps) {
  return serve(['POST'], deps.env.allowedOrigins, async (req) => {
    const b = await readJson(req, Body);
    if (b.kind === 'test') {
      const tok = bearer(req);
      if (!tok || !(await deps.db.isAdminToken(tok))) throw new HttpError(401, 'unauthorized', 'Sign in as an admin.');
      try {
        await deps.messenger.send('✅ Shop Lead Screener: test message. Ideal leads will arrive here.');
      } catch (e) {
        throw new HttpError(502, 'telegram_failed', (e as Error).message);
      }
      return json({ ok: true });
    }
    requireInternal(deps, req);
    const r = await processNotifications(deps, b.response_id ?? null, 20);
    return json(r);
  });
}
