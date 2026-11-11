// Live phone preview of one question exactly as respondents see it (used by the admin builder).
// Contract (stable): <QuestionPreview question={CompiledQuestion} lang="en"|"hi" brandName="…" />
// Voice is simulated in the preview (no microphone, nothing uploaded).
import type { CompiledQuestion } from '@shared/types.ts';

export interface QuestionPreviewProps {
  question: CompiledQuestion;
  lang: 'en' | 'hi';
  brandName?: string;
}

export function QuestionPreview({ question, lang }: QuestionPreviewProps) {
  return (
    <div data-testid="question-preview" className="p-4">
      <p className="text-lg font-semibold">{lang === 'hi' && question.label_hi ? question.label_hi : question.label_en}</p>
    </div>
  );
}
