import { describe, expect, it } from 'vitest';
import { defaultModes } from '@shared/input-modes.ts';
import { compileQuestion } from '@shared/compile.ts';
import { checkModes, clampInt, modesForKind, patchMode, respondentHint, setModeEnabled, setPrimary, setStyle } from '../../src/admin/form/modes.ts';
import { moveId } from '../../src/admin/form/OptionsEditor.tsx';
import { toDraft, toRef } from '../../src/admin/form/draft.ts';
import { isChoice, isNumeric, opsFor } from '../../src/admin/form/conditionValue.ts';
import { inviteResultText, isLastOwner, passwordProblem, validEmail } from '../../src/admin/admins/lastOwner.ts';
import { primaryText, voiceVersions, wordDiff } from '../../src/admin/lead/voiceCompare.ts';
import { fitWithin, pickQuality } from '../../src/admin/settings/image.ts';
import { phoneField } from '../../src/admin/settings/Brand.tsx';
import type { QuestionRow } from '../../src/admin/types.ts';

describe('input modes editing', () => {
  it('turning modes on/off keeps a valid primary and never leaves zero modes', () => {
    let m = defaultModes();
    m = setModeEnabled(m, 'type', true);
    expect(m.primary).toBe('choose');
    m = setModeEnabled(m, 'choose', false);
    expect(m.primary).toBe('type');
    expect(setModeEnabled(m, 'type', false)).toBe(m); // last one stays on
    m = setModeEnabled(m, 'speak', true);
    m = setPrimary(m, 'speak');
    expect(m.primary).toBe('speak');
    expect(setPrimary(m, 'choose')).toBe(m); // cannot make a disabled mode primary
    expect(checkModes(m).ok).toBe(true);
  });
  it('single-select styles clear pick limits', () => {
    let m = setStyle(defaultModes(), 'checkbox');
    m = patchMode(m, 'choose', { min_picks: 1, max_picks: 3 });
    expect(m.choose.max_picks).toBe(3);
    m = setStyle(m, 'dropdown');
    expect([m.choose.min_picks, m.choose.max_picks]).toEqual([null, null]);
  });
  it('zod errors are reported per field', () => {
    const bad = patchMode(patchMode(defaultModes(), 'type', { enabled: true, min_chars: 60, max_chars: 50 }), 'speak', { max_seconds: 400 });
    const r = checkModes(bad);
    expect(r.ok).toBe(false);
    expect(Object.keys(r.errors)).toEqual(expect.arrayContaining(['type.min_chars', 'speak.max_seconds']));
  });
  it('bounds and kind changes', () => {
    expect(clampInt(5000, 1, 2000)).toBe(2000);
    expect(clampInt(3.6, 0, 10)).toBe(4);
    expect(clampInt(null, 0, 1)).toBeNull();
    expect(modesForKind('date', defaultModes())).toBeNull();
    expect(modesForKind('standard', null)).toEqual(defaultModes());
  });
  it('describes what respondents see', () => {
    const m = setModeEnabled(setModeEnabled(defaultModes(), 'type', true), 'speak', true);
    expect(respondentHint(m)).toBe('Respondents first see options to pick, with “Type instead” and “Speak instead” as quiet links.');
  });
});

const row = (over: Partial<QuestionRow> = {}): QuestionRow => ({
  id: 'q1', property_id: 'p', key: 'biz', kind: 'standard', input_modes: defaultModes(), label_en: 'Business', label_hi: null, help_en: null, help_hi: null,
  required: true, position: 0, show_if: null, validation: {}, archived_at: null, first_published_at: null, created_at: '', updated_at: '',
  question_options: [
    { id: 'o2', question_id: 'q1', value: 'b', label_en: 'B', label_hi: null, position: 1, archived_at: null, first_published_at: null, created_at: '' },
    { id: 'o1', question_id: 'q1', value: 'a', label_en: 'A', label_hi: 'ए', position: 0, archived_at: null, first_published_at: null, created_at: '' },
  ],
  ...over,
});

describe('builder rows', () => {
  it('row → draft → compiled preview reflects modes instantly', () => {
    const q = row({ input_modes: setModeEnabled(defaultModes(), 'type', true) });
    const c = compileQuestion(toDraft(q));
    expect(c.options.map((o) => o.value)).toEqual(['a', 'b']);
    expect(c.input_modes?.type.enabled).toBe(true);
  });
  it('refs drive condition operators', () => {
    expect(isChoice(toRef(row()))).toBe(true);
    const num = row({ input_modes: { ...defaultModes(), primary: 'type', choose: { ...defaultModes().choose, enabled: false }, type: { ...defaultModes().type, enabled: true, format: 'number' } } });
    expect(isNumeric(toRef(num))).toBe(true);
    expect(opsFor(toRef(num))).toContain('gte');
    expect(opsFor(toRef(row()))).not.toContain('contains_all'); // radio = single select
    expect(opsFor(toRef(row({ input_modes: setStyle(defaultModes(), 'chips') })))).toContain('contains_all');
  });
  it('moves options with arrows', () => {
    expect(moveId(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(moveId(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c']);
  });
});

describe('admins', () => {
  const admins = [
    { user_id: 'o1', role: 'owner' as const },
    { user_id: 's1', role: 'staff' as const },
  ];
  it('the only owner cannot be removed or demoted; with two owners either can', () => {
    expect(isLastOwner(admins[0], admins)).toBe(true);
    expect(isLastOwner(admins[1], admins)).toBe(false);
    const two = [...admins, { user_id: 'o2', role: 'owner' as const }];
    expect(isLastOwner(two[0], two)).toBe(false);
  });
  it('invite results, emails, passwords', () => {
    expect(inviteResultText({ invited: true })).toMatch(/Invite email sent/);
    expect(inviteResultText({ invited: false })).toMatch(/Already had an account — added as admin/);
    expect(validEmail('a@shop.in')).toBe(true);
    expect(validEmail('nope')).toBe(false);
    expect(passwordProblem('short', 'short')).toMatch(/8 characters/);
    expect(passwordProblem('longenough', 'different')).toMatch(/different/);
    expect(passwordProblem('longenough', 'longenough')).toBeNull();
  });
});

describe('voice compare', () => {
  const n = { transcript_live: 'kirana dukan', transcript_machine: 'kirana dukaan kholna hai', transcript_final: 'Kirana dukaan, 10 saal', status: 'submitted', storage_path: 'p/r/a.webm', audio_missing: false };
  it('final text first, then Whisper, then live', () => {
    expect(primaryText(n)).toBe('Kirana dukaan, 10 saal');
    expect(primaryText({ ...n, transcript_final: null })).toBe('kirana dukaan kholna hai');
    expect(primaryText({ transcript_live: 'x', transcript_machine: null, transcript_final: null })).toBe('x');
  });
  it('lists all three versions with reasons when missing', () => {
    const v = voiceVersions({ ...n, transcript_machine: null, storage_path: null, audio_missing: true });
    expect(v.map((x) => x.key)).toEqual(['live', 'whisper', 'sent']);
    expect(v[1].missing).toBe('No recording to transcribe');
  });
  it('word diff highlights edits', () => {
    expect(wordDiff('a b c', 'a x c')).toEqual([
      { text: 'a', kind: 'same' },
      { text: 'b', kind: 'removed' },
      { text: 'x', kind: 'added' },
      { text: 'c', kind: 'same' },
    ]);
    expect(wordDiff('', 'new words')).toEqual([{ text: 'new words', kind: 'added' }]);
  });
});

describe('brand images and phones', () => {
  it('fits within 1200 px without upscaling', () => {
    expect(fitWithin(4000, 3000)).toEqual({ w: 1200, h: 900 });
    expect(fitWithin(800, 1600)).toEqual({ w: 600, h: 1200 });
    expect(fitWithin(300, 200)).toEqual({ w: 300, h: 200 });
  });
  it('picks the first quality under 1 MB', () => {
    expect(pickQuality([{ q: 0.9, bytes: 2e6 }, { q: 0.8, bytes: 900_000 }, { q: 0.7, bytes: 500_000 }])).toBe(0.8);
    expect(pickQuality([{ q: 0.9, bytes: 2e6 }])).toBeNull();
  });
  it('normalises contact numbers', () => {
    expect(phoneField('98765 43210')).toBe('+919876543210');
    expect(phoneField('')).toBeNull();
    expect(phoneField('123')).toBe(false);
  });
});
