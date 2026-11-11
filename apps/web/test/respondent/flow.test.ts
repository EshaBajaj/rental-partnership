import { describe, expect, it } from 'vitest';
import { compileForm } from '@shared/compile.ts';
import { amountWords, answersToSubmit, nextKey, parseAmount, prevKey, resolveCurrent, totalScreens, visibleQuestions } from '../../src/respondent/flow.ts';
import { baseMime, pickRecorderMime } from '../../src/respondent/recorder.ts';
import { seedForm } from '../fixtures.ts';

const cfg = compileForm(seedForm());

describe('flow', () => {
  it('first answer opens the matching path; shared questions asked once', () => {
    expect(visibleQuestions(cfg, { path: { choose: ['partner'] } }).map((q) => q.key)).toEqual([
      'path', 'business_type', 'start_when', 'investment', 'partner_role', 'experience', 'about_you', 'contact',
    ]);
    expect(nextKey(cfg, { path: { choose: ['rent'] } }, 'start_when')).toBe('rent_budget');
    expect(nextKey(cfg, { path: { choose: ['partner'] } }, 'start_when')).toBe('investment');
    expect(nextKey(cfg, { path: { choose: ['rent'] } }, 'contact')).toBeNull();
    expect(prevKey(cfg, { path: { choose: ['partner'] } }, 'experience')).toBe('partner_role');
  });

  it('progress total uses the longest path until the path is chosen', () => {
    expect(totalScreens(cfg, {})).toBe(8);
    expect(totalScreens(cfg, { path: { choose: ['rent'] } })).toBe(8);
  });

  it('every path is ≤ 9 screens', () => {
    for (const p of ['rent', 'partner', 'either']) expect(visibleQuestions(cfg, { path: { choose: [p] } }).length).toBeLessThanOrEqual(9);
  });

  it('switching path discards answers to now-hidden questions on submit', () => {
    const answers = { path: { choose: ['partner'] }, rent_budget: { text: '40000' }, investment: { text: '500000' } };
    expect(Object.keys(answersToSubmit(cfg, answers))).toEqual(['path', 'investment']);
  });

  it('pending voice answers (empty text) are still sent', () => {
    const answers = { path: { choose: ['rent'] }, about_you: { text: '', voice: true } };
    expect(answersToSubmit(cfg, answers)).toHaveProperty('about_you');
    expect(answersToSubmit(cfg, { path: { choose: ['rent'] }, about_you: { text: '' } })).not.toHaveProperty('about_you');
  });

  it('resolveCurrent falls back when the current question became hidden', () => {
    expect(resolveCurrent(cfg, { path: { choose: ['rent'] } }, 'investment')).toBe('business_type');
    expect(resolveCurrent(cfg, {}, null)).toBe('path');
    expect(resolveCurrent(cfg, { path: { choose: ['rent'] } }, 'lease_years')).toBe('lease_years');
  });

  it('amounts', () => {
    expect(parseAmount('45,000')).toBe(45000);
    expect(parseAmount('₹ 1,00,000')).toBe(100000);
    expect(parseAmount('abc')).toBeNull();
    expect(amountWords(45000, 'en')).toBe('45 thousand');
    expect(amountWords(1250000, 'en')).toBe('12.5 lakh');
    expect(amountWords(25000000, 'hi')).toBe('2.5 करोड़');
    expect(amountWords(500, 'en')).toBe('');
  });
});

describe('recorder mime', () => {
  it('picks the first supported allowed type', () => {
    expect(pickRecorderMime((m) => m === 'audio/mp4')).toBe('audio/mp4');
    expect(pickRecorderMime(() => false)).toBeNull();
    expect(baseMime('audio/webm;codecs=opus')).toBe('audio/webm');
    expect(baseMime('audio/x-caf')).toBeNull();
  });
});
