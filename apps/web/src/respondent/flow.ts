// Pure questionnaire flow logic (unit-tested in test/respondent/flow.test.ts).
import type { CompiledQuestion, FormConfig, RawAnswer, RawAnswers, Values } from '@shared/types.ts';
import { PATH_KEY, PATH_VALUES } from '@shared/types.ts';
import { computeVisibility, isAnswered } from '@shared/showif.ts';
import { rawEngineValue } from '@shared/answers.ts';

export function engineValues(answers: RawAnswers): Values {
  const out: Values = {};
  for (const [k, a] of Object.entries(answers)) out[k] = rawEngineValue(a);
  return out;
}

export function visibleQuestions(config: FormConfig, answers: RawAnswers): CompiledQuestion[] {
  const { visible } = computeVisibility(config, engineValues(answers));
  const set = new Set(visible);
  return config.questions.filter((q) => set.has(q.key));
}

export function nextKey(config: FormConfig, answers: RawAnswers, current: string): string | null {
  const vis = visibleQuestions(config, answers);
  const order = config.questions.map((q) => q.key);
  const ci = order.indexOf(current);
  return vis.find((q) => order.indexOf(q.key) > ci)?.key ?? null;
}

export function prevKey(config: FormConfig, answers: RawAnswers, current: string): string | null {
  const vis = visibleQuestions(config, answers);
  const order = config.questions.map((q) => q.key);
  const ci = order.indexOf(current);
  const before = vis.filter((q) => order.indexOf(q.key) < ci);
  return before.length ? before[before.length - 1].key : null;
}

/** Answers to send: only visible questions, only answered ones. Hidden answers are discarded. */
export function answersToSubmit(config: FormConfig, answers: RawAnswers): RawAnswers {
  const out: RawAnswers = {};
  for (const q of visibleQuestions(config, answers)) {
    const a: RawAnswer | undefined = answers[q.key];
    if (!a) continue;
    if (!isAnswered(rawEngineValue(a)) && q.kind !== 'contact') continue;
    out[q.key] = a;
  }
  return out;
}

/** Make sure `current` is still visible (answers may have changed); otherwise pick the first unanswered visible. */
export function resolveCurrent(config: FormConfig, answers: RawAnswers, current: string | null): string {
  const vis = visibleQuestions(config, answers);
  if (current && vis.some((q) => q.key === current)) return current;
  return (vis.find((q) => !(q.key in answers)) ?? vis[0]).key;
}

export function amountWords(n: number, lang: 'en' | 'hi'): string {
  if (!Number.isFinite(n) || n < 1000) return '';
  const trim = (x: number) => String(Math.round(x * 100) / 100);
  if (n >= 1e7) return `${trim(n / 1e7)} ${lang === 'hi' ? 'करोड़' : 'crore'}`;
  if (n >= 1e5) return `${trim(n / 1e5)} ${lang === 'hi' ? 'लाख' : 'lakh'}`;
  return `${trim(n / 1e3)} ${lang === 'hi' ? 'हज़ार' : 'thousand'}`;
}

const inr = new Intl.NumberFormat('en-IN');
export const formatInr = (n: number) => `₹${inr.format(n)}`;

export { parseNumber as parseAmount } from '@shared/answers.ts';

/** Screens to show in the progress bar: before the path is chosen, assume the longest path. */
export function totalScreens(config: FormConfig, answers: RawAnswers): number {
  if (answers[PATH_KEY]?.choose?.length) return visibleQuestions(config, answers).length;
  return Math.max(...PATH_VALUES.map((p) => visibleQuestions(config, { ...answers, [PATH_KEY]: { choose: [p] } }).length));
}
