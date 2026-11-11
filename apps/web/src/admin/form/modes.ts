// Pure helpers for editing a question's input modes in the builder (unit-tested).
import type { ChooseStyle, InputMode, InputModes, QuestionKind } from '@shared/types.ts';
import { InputModesSchema } from '@shared/schemas.ts';
import { defaultModes, isSingleSelect, LIMITS, withDefaults } from '@shared/input-modes.ts';

export const MODE_LABEL: Record<InputMode, string> = { choose: 'Choose', type: 'Type', speak: 'Speak' };
export const STYLE_LABEL: Record<ChooseStyle, string> = { radio: 'Radio buttons (pick one)', checkbox: 'Checkboxes (pick several)', dropdown: 'Dropdown (pick one)', chips: 'Chips (pick several)' };
export const KIND_LABEL: Record<QuestionKind, string> = { standard: 'Standard (choose / type / speak)', yes_no: 'Yes / No', date: 'Date', contact: 'Contact details' };

/** Bounds for every number input in the modes editor. */
export const BOUNDS = {
  chars: { min: 0, max: LIMITS.maxChars },
  otherChars: { min: 1, max: LIMITS.otherMaxChars },
  seconds: { min: LIMITS.speakMinSeconds, max: LIMITS.speakMaxSeconds },
  picks: { min: 0, max: LIMITS.maxPicks },
} as const;

export function clampInt(v: number | null, min: number, max: number): number | null {
  if (v === null || !Number.isFinite(v)) return null;
  return Math.min(max, Math.max(min, Math.round(v)));
}

const clone = (m: InputModes): InputModes => ({ primary: m.primary, choose: { ...m.choose }, type: { ...m.type }, speak: { ...m.speak } });

/**
 * Switch a mode on/off. Turning off the primary moves "primary" to another enabled mode;
 * turning a mode on when nothing else is on makes it primary. Never leaves zero modes on:
 * switching off the last one is refused (returns the input unchanged).
 */
export function setModeEnabled(m: InputModes, mode: InputMode, on: boolean): InputModes {
  const next = clone(m);
  if (!on) {
    const others = (['choose', 'type', 'speak'] as const).filter((k) => k !== mode && next[k].enabled);
    if (others.length === 0) return m;
    next[mode].enabled = false;
    if (next.primary === mode) next.primary = others[0];
    return next;
  }
  const wasNone = !next.choose.enabled && !next.type.enabled && !next.speak.enabled;
  next[mode].enabled = true;
  if (wasNone || !next[next.primary].enabled) next.primary = mode;
  return next;
}

export function setPrimary(m: InputModes, mode: InputMode): InputModes {
  if (!m[mode].enabled) return m;
  return { ...clone(m), primary: mode };
}

export function patchMode<K extends InputMode>(m: InputModes, mode: K, patch: Partial<InputModes[K]>): InputModes {
  const next = clone(m);
  (next[mode] as InputModes[K]) = { ...next[mode], ...patch };
  // single-select styles have no pick limits
  if (mode === 'choose' && isSingleSelect(next.choose)) {
    next.choose.min_picks = null;
    next.choose.max_picks = null;
  }
  return next;
}

export function setStyle(m: InputModes, style: ChooseStyle): InputModes {
  return patchMode(m, 'choose', { style });
}

export interface ModesCheck {
  ok: boolean;
  /** messages by field path, e.g. "type.max_chars" or "" for general */
  errors: Record<string, string>;
}

/** zod validation (the same schema the server-side tools use). */
export function checkModes(m: InputModes): ModesCheck {
  const r = InputModesSchema.safeParse(m);
  if (r.success) return { ok: true, errors: {} };
  const errors: Record<string, string> = {};
  for (const i of r.error.issues) {
    const k = i.path.join('.');
    if (!errors[k]) errors[k] = i.message;
  }
  return { ok: false, errors };
}

/** Modes for a question changing kind (unpublished questions only — published ones get a new key). */
export function modesForKind(kind: QuestionKind, current: InputModes | null): InputModes | null {
  if (kind !== 'standard') return null;
  return current ? withDefaults(current) : defaultModes();
}

/** Respondent-facing summary of what they will see, for the builder. */
export function respondentHint(m: InputModes): string {
  const others = (['choose', 'type', 'speak'] as const).filter((k) => k !== m.primary && m[k].enabled);
  const link: Record<InputMode, string> = { choose: '“Choose instead”', type: '“Type instead”', speak: '“Speak instead”' };
  const main = m.primary === 'choose' ? 'options to pick' : m.primary === 'type' ? 'a text box' : 'a microphone button';
  return others.length ? `Respondents first see ${main}, with ${others.map((o) => link[o]).join(' and ')} as quiet links.` : `Respondents see ${main}.`;
}
