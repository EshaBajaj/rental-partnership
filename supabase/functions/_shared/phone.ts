// Phone normalisation (India default). Uses the "min" metadata build to keep bundles small.
import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/min';

export const DEFAULT_COUNTRY: CountryCode = 'IN';

/** Returns E.164 (e.g. +919876543210) or null when the number is not valid. */
export function normalisePhone(raw: string, country: CountryCode = DEFAULT_COUNTRY): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.trim().replace(/[\s\-().]/g, '').replace(/^00/, '+');
  if (cleaned.length < 6 || cleaned.length > 20) return null;
  const p = parsePhoneNumberFromString(cleaned, country);
  if (!p || !p.isValid()) return null;
  return p.number;
}

/** Pretty format for display, e.g. +91 98765 43210 */
export function formatPhone(e164: string): string {
  const p = parsePhoneNumberFromString(e164);
  return p ? p.formatInternational() : e164;
}

/** wa.me link digits (no +) */
export function whatsappDigits(e164: string): string {
  return e164.replace(/^\+/, '');
}
