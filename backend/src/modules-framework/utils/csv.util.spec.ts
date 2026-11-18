import { recordsToCsv } from './csv.util';

describe('recordsToCsv', () => {
  it('returns an empty string for no rows', () => {
    expect(recordsToCsv([])).toBe('');
  });

  it('builds a header from the union of all row keys, in first-seen order', () => {
    const csv = recordsToCsv([{ id: 'A-1', short: 'Kaveri' }, { id: 'A-2', short: 'Shivalik', gstin: 'G1' }]);
    expect(csv).toBe('id,short,gstin\nA-1,Kaveri,\nA-2,Shivalik,G1');
  });

  it('quotes values containing commas, quotes, or newlines', () => {
    const csv = recordsToCsv([{ note: 'Hello, "world"\nnext line' }]);
    expect(csv).toBe('note\n"Hello, ""world""\nnext line"');
  });

  it('JSON-stringifies nested objects/arrays', () => {
    const csv = recordsToCsv([{ tags: ['a', 'b'] }]);
    expect(csv).toBe('tags\n"[""a"",""b""]"');
  });

  it('leaves out internal columns (orgId, isDeleted, updatedAt, sla, foreign-key ids) but keeps the record id', () => {
    const csv = recordsToCsv([{ id: 'x', orgId: 'o', accountId: 'a', ownerId: 'u', isDeleted: false, updatedAt: 't', sla: {}, title: 'Deal', value: 5 }]);
    expect(csv).toBe('id,title,value\nx,Deal,5');
  });

  it('renders null/undefined as an empty field', () => {
    const csv = recordsToCsv([{ a: null, b: undefined }]);
    expect(csv).toBe('a,b\n,');
  });
});
