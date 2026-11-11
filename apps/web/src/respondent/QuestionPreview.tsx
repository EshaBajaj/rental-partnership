// Live phone preview of one question exactly as respondents see it (used by the admin builder).
// Contract (stable): <QuestionPreview question={CompiledQuestion} lang="en"|"hi" brandName="…" />
// Voice is simulated in the preview (no microphone, nothing uploaded); answers stay local.
import { useEffect, useState } from 'react';
import type { CompiledQuestion, RawAnswer } from '@shared/types.ts';
import { ERROR_TEXT, validateOne } from '@shared/answers.ts';
import { QuestionInput } from './inputs.tsx';
import { pick, t } from './i18n.ts';
import { LockIcon } from './Trust.tsx';

export interface QuestionPreviewProps {
  question: CompiledQuestion;
  lang: 'en' | 'hi';
  brandName?: string;
}

export function QuestionPreview({ question: q, lang, brandName = 'Bajaj Computers' }: QuestionPreviewProps) {
  const [value, setValue] = useState<RawAnswer | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  // a structural change (kind / modes / options) resets the sample answer
  const sig = JSON.stringify([q.kind, q.input_modes, q.options.map((o) => o.value)]);
  useEffect(() => {
    setValue(undefined);
    setError(null);
  }, [sig]);
  const help = pick(lang, q.help_en ?? '', q.help_hi);
  return (
    <div data-testid="question-preview" className="respondent bg-bg text-ink" style={{ colorScheme: 'light' }}>
      <div className="flex min-h-[560px] flex-col px-4 pb-3 pt-4">
        <p className="mb-4 text-xs text-muted">{brandName}</p>
        <h3 className="text-xl font-semibold leading-snug">{pick(lang, q.label_en || '…', q.label_hi)}</h3>
        {help && <p className="mt-2 text-sm text-muted">{help}</p>}
        {!q.required && q.kind !== 'contact' && <p className="mt-1 text-xs text-muted">{t(lang, 'optional')}</p>}
        <div className="mt-5">
          <QuestionInput
            q={q}
            lang={lang}
            value={value}
            onChange={(a) => {
              setError(null);
              setValue(a);
            }}
            onPicked={() => undefined}
            ctx={{ slug: 'preview', responseId: '00000000-0000-4000-8000-000000000000', formVersionId: '', preview: true }}
            uploads={0}
            onUploaded={() => undefined}
            onBusy={() => undefined}
          />
        </div>
        {error && <p role="alert" className="mt-3 rounded-xl border border-line bg-surface p-3 text-sm text-danger">{error}</p>}
        <div className="flex-1" />
        <button
          type="button"
          className="r-btn-primary mt-6 w-full"
          onClick={() => {
            const r = validateOne(q, value);
            setError(r.ok ? null : ERROR_TEXT[r.code][lang]);
          }}
        >
          {t(lang, 'next')}
        </button>
        <p className="mt-3 flex items-center justify-center gap-1 text-xs text-muted">
          <LockIcon />
          {t(lang, 'sharedOnlyWith', { brand: brandName })}
        </p>
      </div>
    </div>
  );
}
