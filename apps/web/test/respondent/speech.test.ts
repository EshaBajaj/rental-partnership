import { describe, expect, it } from 'vitest';
import {
  getRecognitionCtor,
  isInAppBrowser,
  isNearSilent,
  joinTranscript,
  levenshtein,
  normalizeForCompare,
  shouldOfferClearerVersion,
  speechLangFor,
  textDifference,
} from '../../src/respondent/speech.ts';

describe('levenshtein / textDifference', () => {
  it('classic distances', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('दुकान', 'दुकान')).toBe(0);
  });
  it('normalises case, punctuation and spaces', () => {
    expect(normalizeForCompare('  Kirana,  dukaan!! ')).toBe('kirana dukaan');
    expect(textDifference('Kirana dukaan.', 'kirana   DUKAAN')).toBe(0);
  });
  it('is normalised by the longer text', () => {
    expect(textDifference('abcd', 'abcx')).toBeCloseTo(0.25);
    expect(textDifference('', '')).toBe(0);
    expect(textDifference('abc', '')).toBe(1);
  });
});

describe('clearer version offer', () => {
  it('only when different by more than 15% and the respondent has not edited', () => {
    const live = 'main kirana dukan kholna chahta hu';
    const whisper = 'Main kirana dukaan kholna chahta hoon, 10 saal ka anubhav hai';
    expect(shouldOfferClearerVersion(live, whisper, false)).toBe(true);
    expect(shouldOfferClearerVersion(live, whisper, true)).toBe(false);
    expect(shouldOfferClearerVersion(live, 'Main kirana dukan kholna chahta hu.', false)).toBe(false); // ≤ 15% different
    expect(shouldOfferClearerVersion('', whisper, false)).toBe(false); // no live text → Whisper fills the box instead
    expect(shouldOfferClearerVersion(live, '  ', false)).toBe(false);
  });
});

describe('environment detection', () => {
  it('in-app browsers', () => {
    expect(isInAppBrowser('Mozilla/5.0 (Linux; Android 13; wv) AppleWebKit Instagram 300.0')).toBe(true);
    expect(isInAppBrowser('Mozilla/5.0 [FBAN/FBIOS;FBAV/400.0]')).toBe(true);
    expect(isInAppBrowser('Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari/537.36')).toBe(false);
  });
  it('SpeechRecognition feature detection', () => {
    class R {}
    expect(getRecognitionCtor({ webkitSpeechRecognition: R, navigator: { userAgent: 'Chrome' } })).toBe(R);
    expect(getRecognitionCtor({ SpeechRecognition: R, navigator: { userAgent: 'Chrome' } })).toBe(R);
    expect(getRecognitionCtor({ navigator: { userAgent: 'Safari' } })).toBeNull();
    expect(getRecognitionCtor({ webkitSpeechRecognition: R, navigator: { userAgent: 'Instagram 300' } })).toBeNull();
  });
  it('near-silent audio: < 1 KB per second', () => {
    expect(isNearSilent(500, 2)).toBe(true);
    expect(isNearSilent(6000, 2)).toBe(false);
    expect(isNearSilent(900, 0.4)).toBe(true);
  });
  it('speech language and transcript joining', () => {
    expect(speechLangFor(null, 'en-IN')).toBe('en-IN');
    expect(speechLangFor('hi-IN', 'en-IN')).toBe('hi-IN');
    expect(speechLangFor(null, undefined)).toBe('hi-IN');
    expect(joinTranscript([' mujhe ', 'dukaan chahiye'], ' abhi ')).toEqual({ final: 'mujhe dukaan chahiye', interim: 'abhi' });
  });
});
