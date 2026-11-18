import { buildSheetHeader, buildSheetRow, questionsFromDoc } from './form-sheet.util';

const questions = [
  { id: 'q1', title: 'Course' },
  { id: 'q2', title: 'City' },
];

describe('form-sheet.util', () => {
  it('builds the header from the fixed columns plus question titles in order', () => {
    expect(buildSheetHeader(questions)).toEqual(['Submitted at', 'Lead name', 'Lead owner', 'Course', 'City']);
  });

  it('builds a row aligned to the header, leaving unanswered questions empty', () => {
    const row = buildSheetRow(
      { submittedAt: new Date('2026-09-24T10:00:00.000Z'), leadName: 'Asha', ownerName: null, answers: { City: 'Pune' } },
      questions,
    );
    expect(row).toEqual(['2026-09-24T10:00:00.000Z', 'Asha', '', '', 'Pune']);
  });

  it('extracts question ids and titles from form items, skipping non-question items', () => {
    expect(
      questionsFromDoc([
        { itemId: 'a', title: 'Intro' },
        { itemId: 'b', title: 'Course', questionItem: { question: { questionId: 'q1' } } },
      ]),
    ).toEqual([{ id: 'q1', title: 'Course' }]);
    expect(questionsFromDoc(undefined)).toEqual([]);
  });
});
