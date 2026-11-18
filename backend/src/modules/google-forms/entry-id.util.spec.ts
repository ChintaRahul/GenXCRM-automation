import { entryIdFromQuestionId, parseEntryIdFromPublicPage, resolveEntryId } from './entry-id.util';

const item = (id: number, title: string, entryId: number) => [id, title, null, 0, [[entryId, null, 0]]];
const page = (items: unknown[]) =>
  `<html><body><script>var FB_PUBLIC_LOAD_DATA_ = ${JSON.stringify([null, ['About', items]])};</script></body></html>`;

describe('entryIdFromQuestionId', () => {
  it('converts a hex question id to its decimal string', () => {
    expect(entryIdFromQuestionId('0000002a')).toBe('42');
    expect(entryIdFromQuestionId('FFFFFFFF')).toBe('4294967295');
  });

  it('returns null for a non-hex id', () => {
    expect(entryIdFromQuestionId('not-hex')).toBeNull();
    expect(entryIdFromQuestionId('')).toBeNull();
  });
});

describe('parseEntryIdFromPublicPage', () => {
  it('finds the entry id of the item with the given title, case-insensitively', () => {
    const html = page([item(1, 'Name', 111), item(2, ' lead id ', 222)]);
    expect(parseEntryIdFromPublicPage(html, 'Lead ID')).toBe('222');
  });

  it('returns null when the title is missing, the marker is absent, or the data is malformed', () => {
    expect(parseEntryIdFromPublicPage(page([item(1, 'Name', 111)]), 'Lead ID')).toBeNull();
    expect(parseEntryIdFromPublicPage('<html></html>', 'Lead ID')).toBeNull();
    expect(parseEntryIdFromPublicPage('FB_PUBLIC_LOAD_DATA_ = {oops;</script>', 'Lead ID')).toBeNull();
  });
});

describe('resolveEntryId', () => {
  const base = { questionId: '0000002a', title: 'Lead ID' }; // derives to 42

  it('uses the page value without warning when it equals the derivation', async () => {
    const warn = jest.fn();
    const fetchPublicPage = jest.fn().mockResolvedValue(page([item(2, 'Lead ID', 42)]));
    expect(await resolveEntryId({ ...base, fetchPublicPage, warn })).toBe('42');
    expect(warn).not.toHaveBeenCalled();
  });

  it('prefers the page value and warns when it differs from the derivation', async () => {
    const warn = jest.fn();
    const fetchPublicPage = jest.fn().mockResolvedValue(page([item(2, 'Lead ID', 987)]));
    expect(await resolveEntryId({ ...base, fetchPublicPage, warn })).toBe('987');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('differs'));
  });

  it('falls back to the derivation with a warning when the page fetch rejects', async () => {
    const warn = jest.fn();
    const fetchPublicPage = jest.fn().mockRejectedValue(new Error('boom'));
    expect(await resolveEntryId({ ...base, fetchPublicPage, warn })).toBe('42');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unverified'));
  });

  it('falls back to the derivation with a warning when the page has no entry id', async () => {
    const warn = jest.fn();
    const fetchPublicPage = jest.fn().mockResolvedValue(page([item(1, 'Name', 1)]));
    expect(await resolveEntryId({ ...base, fetchPublicPage, warn })).toBe('42');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unverified'));
  });

  it('returns null when neither the page nor the derivation yields a value', async () => {
    const fetchPublicPage = jest.fn().mockRejectedValue(new Error('boom'));
    expect(await resolveEntryId({ questionId: 'not-hex', title: 'Lead ID', fetchPublicPage })).toBeNull();
  });
});
