import type { GoogleFormItem } from './google-api.client';

export interface QuestionMeta {
  id: string;
  title: string;
}

export const SHEET_FIXED_COLUMNS = ['Submitted at', 'Lead name', 'Lead owner'] as const;

export const buildSheetHeader = (questions: QuestionMeta[]): string[] => [
  ...SHEET_FIXED_COLUMNS,
  ...questions.map((q) => q.title),
];

export const buildSheetRow = (
  row: { submittedAt: Date; leadName: string | null; ownerName: string | null; answers: Record<string, string> },
  questions: QuestionMeta[],
): string[] => [
  row.submittedAt.toISOString(),
  row.leadName ?? '',
  row.ownerName ?? '',
  ...questions.map((q) => row.answers[q.title] ?? ''),
];

export const questionsFromDoc = (items: GoogleFormItem[] | undefined): QuestionMeta[] =>
  (items ?? []).flatMap((item) =>
    item.questionItem ? [{ id: item.questionItem.question.questionId, title: item.title ?? '' }] : [],
  );
