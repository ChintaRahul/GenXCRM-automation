export function parseModuleSort(
  sort: string | undefined,
  allowed: readonly string[],
  fallback: string,
): { field: string; direction: 'asc' | 'desc' } {
  if (!sort) return { field: fallback, direction: 'desc' };
  const direction: 'asc' | 'desc' = sort.startsWith('-') ? 'desc' : 'asc';
  const field = sort.replace(/^-/, '');
  return { field: allowed.includes(field) ? field : fallback, direction };
}
