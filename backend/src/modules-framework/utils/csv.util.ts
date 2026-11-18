function csvEscape(value: unknown): string {
  const s = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Generic CSV from a list of flat-ish records — used for the "export this list" button that
// every module gets for free, as opposed to each module's own bespoke CSV (e.g. reports'
// buildCsv, driven by its own column definitions).
// Database plumbing a user should never see in an export: tenant/soft-delete flags, audit timestamps,
// the raw SLA blob and foreign-key UUIDs (ownerId, accountId, ...).
const INTERNAL_KEYS = new Set(['orgId', 'isDeleted', 'updatedAt', 'sla']);
const isInternalKey = (key: string): boolean => INTERNAL_KEYS.has(key) || (key !== 'id' && key.endsWith('Id'));

export function recordsToCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))].filter((key) => !isInternalKey(key));
  const header = keys.map(csvEscape).join(',');
  const lines = rows.map((row) => keys.map((key) => csvEscape(row[key])).join(','));
  return [header, ...lines].join('\n');
}
