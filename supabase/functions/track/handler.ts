// POST /track → batched funnel events (rate-limited per ip_hash).
import { clientIp, HttpError, json, readJson, serve } from '../_shared/server/http.ts';
import type { Deps } from '../_shared/server/deps.ts';
import { ipHash, rateLimit } from '../_shared/server/core.ts';
import { TrackBody } from '../_shared/schemas.ts';

export function makeHandler(deps: Deps) {
  return serve(['POST'], deps.env.allowedOrigins, async (req) => {
    const body = await readJson(req, TrackBody);
    const ip = await ipHash(deps, clientIp(req));
    await rateLimit(deps, 'track', ip, 120, 600);
    const p = await deps.db.propertyBySlug(body.property_slug);
    if (!p) throw new HttpError(404, 'not_found', 'Unknown form.');
    await deps.db.insertFunnelEvents(
      body.events.map((e) => ({ property_id: p.id, session_id: body.session_id, event: e.event, question_key: e.question_key ?? null, ms: e.ms ?? null, ip_hash: ip })),
    );
    return json(null, 204);
  });
}
