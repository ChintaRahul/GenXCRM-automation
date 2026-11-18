// Fallback derivation: the Forms API questionId (hex string) is the prefill entry id in base 16.
export const entryIdFromQuestionId = (questionId: string): string | null =>
  /^[0-9a-f]+$/i.test(questionId) ? BigInt(`0x${questionId}`).toString() : null;

const PAGE_MARKER = 'FB_PUBLIC_LOAD_DATA_ = ';

// Ground truth: read the entry id from the form's public page (what Google actually renders). The page embeds
// FB_PUBLIC_LOAD_DATA_ = [null, [description, [item, ...]], ...] where each item is
// [itemId, title, helpText, type, [[entryId, options, required, ...]]].
export const parseEntryIdFromPublicPage = (html: string, title: string): string | null => {
  const start = html.indexOf(PAGE_MARKER);
  if (start === -1) return null;
  const from = start + PAGE_MARKER.length;
  const end = html.indexOf(';</script>', from);
  if (end === -1) return null;

  let data: unknown;
  try {
    data = JSON.parse(html.slice(from, end));
  } catch {
    return null;
  }
  const items = (data as unknown[][] | null)?.[1]?.[1];
  if (!Array.isArray(items)) return null;

  const wanted = title.trim().toLowerCase();
  for (const item of items) {
    if (!Array.isArray(item)) continue;
    const itemTitle = typeof item[1] === 'string' ? item[1].trim().toLowerCase() : '';
    const entryId = (item[4] as unknown[][] | null | undefined)?.[0]?.[0];
    if (itemTitle === wanted && (typeof entryId === 'number' || typeof entryId === 'string')) {
      return String(entryId);
    }
  }
  return null;
};

// The public page is the source of truth; the hex derivation is only a fallback because a wrong rule
// would silently produce prefilled links Google ignores. Mismatches and fallbacks are logged via `warn`.
export const resolveEntryId = async (opts: {
  questionId: string;
  title: string;
  fetchPublicPage: () => Promise<string>;
  warn?: (message: string) => void;
}): Promise<string | null> => {
  const warn = opts.warn ?? (() => undefined);
  const derived = entryIdFromQuestionId(opts.questionId);

  let fromPage: string | null = null;
  let failure = 'the form page could not be read';
  try {
    fromPage = parseEntryIdFromPublicPage(await opts.fetchPublicPage(), opts.title);
    if (!fromPage) failure = 'the form page has no entry id for the question';
  } catch (err) {
    failure = `the form page fetch failed (${err instanceof Error ? err.message : 'unknown error'})`;
  }

  if (fromPage) {
    if (derived && derived !== fromPage) {
      warn(`Entry id from the form page (${fromPage}) differs from the derived one (${derived}); using the page value`);
    }
    return fromPage;
  }
  if (derived) warn(`Entry id is unverified: ${failure}; falling back to the derived value`);
  return derived;
};
