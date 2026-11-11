// GET /form?slug=… → property status + current published config (cached 60 s).
import { HttpError, json, serve } from '../_shared/server/http.ts';
import type { Deps } from '../_shared/server/deps.ts';
import { FormQuery } from '../_shared/schemas.ts';

export function makeHandler(deps: Deps) {
  return serve(['GET'], deps.env.allowedOrigins, async (req) => {
    const q = FormQuery.safeParse({ slug: new URL(req.url).searchParams.get('slug') ?? '' });
    if (!q.success) throw new HttpError(400, 'bad_request', 'Missing or invalid ?slug.');
    const p = await deps.db.propertyBySlug(q.data.slug);
    if (!p) throw new HttpError(404, 'not_found', 'This form does not exist.');
    const property = { slug: p.slug, name: p.name, default_lang: p.default_lang };
    const cache = { 'Cache-Control': 'public, max-age=60, s-maxage=60' };
    if (p.status === 'closed') {
      return json({ status: 'closed', property, closed_message: p.closed_message, form: null }, 200, cache);
    }
    const f = await deps.db.currentForm(p.id);
    if (!f) throw new HttpError(503, 'not_published', 'This form is not ready yet. Please try again later.');
    return json({ status: 'open', property, form: { id: f.id, version: f.version, config: f.config } }, 200, cache);
  });
}
