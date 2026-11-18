// Renders saved message templates ({{placeholder}} text) for one-off sends.

const PLACEHOLDER = /\{\{(\w+)\}\}/g;

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);

// Plain-text fill (subjects, WhatsApp params). Unknown placeholders become empty.
export const fillTemplate = (text: string, values: Readonly<Record<string, string>>): string =>
  text.replace(PLACEHOLDER, (_match, key: string) => values[key] ?? '');

// HTML fill for an email body: the template text and every value are escaped, line breaks become
// <br>, and `linkKeys` values are rendered as clickable links.
export const renderEmailHtml = (
  text: string,
  values: Readonly<Record<string, string>>,
  linkKeys: readonly string[] = [],
): string =>
  escapeHtml(text)
    .replace(PLACEHOLDER, (_match, key: string) => {
      const value = values[key] ?? '';
      if (!value) return '';
      const safe = escapeHtml(value);
      return linkKeys.includes(key) ? `<a href="${safe}">${safe}</a>` : safe;
    })
    .replace(/\r?\n/g, '<br>');
