// POST /admin-invite {email, role} — OWNER only (Bearer = the owner's session token).
// Invites the person by email (Supabase sends the invite; they set their own password) and
// adds/updates their admins row. Existing accounts are just added as admins.
import { bearer, HttpError, json, readJson, serve } from '../_shared/server/http.ts';
import type { Deps } from '../_shared/server/deps.ts';
import { rateLimit } from '../_shared/server/core.ts';
import { z } from 'zod';

const Body = z.object({ email: z.string().trim().toLowerCase().email().max(200), role: z.enum(['owner', 'staff']).default('staff') });

export function makeHandler(deps: Deps) {
  return serve(['POST'], deps.env.allowedOrigins, async (req) => {
    const tok = bearer(req);
    const owner = tok ? await deps.db.ownerFromToken(tok) : null;
    if (!owner) throw new HttpError(403, 'not_owner', 'Only an owner can invite admins.');
    const b = await readJson(req, Body);
    await rateLimit(deps, 'admin-invite', owner, 20, 3600);
    let user: { id: string; invited: boolean };
    try {
      user = await deps.auth.inviteUser(b.email, `${deps.env.adminAppUrl}/admin/login`);
    } catch (e) {
      throw new HttpError(502, 'invite_failed', `Could not send the invite: ${(e as Error).message}`);
    }
    await deps.db.rpc('sls_upsert_admin', { p_user_id: user.id, p_email: b.email, p_role: b.role, p_actor: owner });
    return json({ user_id: user.id, invited: user.invited, role: b.role });
  });
}
