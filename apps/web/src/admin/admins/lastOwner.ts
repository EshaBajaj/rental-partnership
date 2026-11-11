// Who may be demoted / removed (mirrors the DB trigger: there is always at least one owner). Pure, tested.
import type { AdminRow } from '../types.ts';

export const ownerCount = (admins: Pick<AdminRow, 'role'>[]) => admins.filter((a) => a.role === 'owner').length;

/** Removing or demoting this admin would leave no owner. */
export function isLastOwner(a: Pick<AdminRow, 'role' | 'user_id'>, admins: Pick<AdminRow, 'role' | 'user_id'>[]): boolean {
  return a.role === 'owner' && ownerCount(admins.filter((x) => x.user_id !== a.user_id)) === 0;
}

export function inviteResultText(r: { invited: boolean }): string {
  return r.invited ? 'Invite email sent. They set their own password from the link.' : 'Already had an account — added as admin. They can sign in now.';
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const validEmail = (s: string) => EMAIL_RE.test(s.trim());

/** Password rule for the set-password page. Returns a message, or null when fine. */
export function passwordProblem(pw: string, confirm: string): string | null {
  if (pw.length < 8) return 'Use at least 8 characters.';
  if (pw !== confirm) return 'The two passwords are different.';
  return null;
}
