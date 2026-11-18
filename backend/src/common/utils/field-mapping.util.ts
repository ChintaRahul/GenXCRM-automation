export const CORE_FIELD_KEYS = [
  'name',
  'email',
  'phone',
  'altPhone',
  'course',
  'location',
  'language',
  'source',
  'tags',
] as const;

// Name, phone and email are always the first, fixed columns; `source` is already its own
// list column. Everything else is user-orderable.
export const ORDERABLE_CORE_FIELD_KEYS = ['altPhone', 'course', 'location', 'language', 'tags'] as const;

// List columns that are system fields (no aliases) — orderable alongside the mapped fields.
export const SYSTEM_COLUMN_KEYS = ['stage', 'source', 'score', 'owner', 'createdAt'] as const;

// Saved order (core keys + custom field ids) reconciled with what currently exists: drops
// stale entries and appends anything not yet placed, so a new custom field always shows up.
export function normalizeFieldOrder(saved: unknown, customFieldDefs: { id: string }[]): string[] {
  const valid = new Set<string>([...SYSTEM_COLUMN_KEYS, ...ORDERABLE_CORE_FIELD_KEYS, ...customFieldDefs.map((d) => d.id)]);
  const ordered = (Array.isArray(saved) ? saved : []).filter(
    (k): k is string => typeof k === 'string' && valid.has(k),
  );
  const placed = new Set(ordered);
  return [...ordered, ...[...valid].filter((k) => !placed.has(k))];
}

export type CoreFieldKey = (typeof CORE_FIELD_KEYS)[number];

export const DEFAULT_CORE_FIELD_ALIASES: Record<CoreFieldKey, string> = {
  name: '',
  email: '',
  phone: '',
  altPhone: '',
  course: '',
  location: '',
  language: '',
  source: '',
  tags: '',
};

export interface CustomFieldDef {
  id: string;
  name: string;
  aliases: string;
}

export interface OrgFieldMappingConfig {
  coreFieldAliases: Record<string, string>;
  customFieldDefs: CustomFieldDef[];
}

export interface ResolvedOrgFields {
  core: Partial<Record<CoreFieldKey, string>>;
  customFields: Record<string, string>;
  unmatchedKeys: string[];
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function splitAliases(aliases: string): string[] {
  return aliases
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean);
}

/**
 * Matches an org's configured core-field aliases and custom-field definitions
 * (Administration > Field Mappings) against a raw key/value payload from any
 * lead source — a CSV row zipped with headers, Meta's `field_data`, Google's
 * `user_column_data`, or a generic webhook body. Alias/header comparison is
 * case- and punctuation-insensitive (same normalization as the CSV import
 * wizard's own auto-detection) so `"What type of organization do you run?"`
 * matches an alias of `what_type_of_organization_do_you_run`. First alias
 * match wins per field; blank raw values are skipped.
 */
export function resolveOrgFields(raw: Record<string, string>, config: OrgFieldMappingConfig): ResolvedOrgFields {
  const coreIndex = new Map<string, CoreFieldKey>();
  for (const key of CORE_FIELD_KEYS) {
    for (const alias of splitAliases(config.coreFieldAliases[key] ?? '')) {
      coreIndex.set(normalize(alias), key);
    }
  }

  const customIndex = new Map<string, string>();
  for (const def of config.customFieldDefs) {
    for (const alias of splitAliases(def.aliases)) {
      customIndex.set(normalize(alias), def.id);
    }
  }

  const core: Partial<Record<CoreFieldKey, string>> = {};
  const customFields: Record<string, string> = {};
  const unmatchedKeys: string[] = [];

  for (const [rawKey, rawValue] of Object.entries(raw)) {
    if (!rawValue) continue;
    const normalized = normalize(rawKey);

    const coreKey = coreIndex.get(normalized);
    if (coreKey && core[coreKey] === undefined) {
      core[coreKey] = rawValue;
      continue;
    }

    const customFieldId = customIndex.get(normalized);
    if (customFieldId && customFields[customFieldId] === undefined) {
      customFields[customFieldId] = rawValue;
      continue;
    }

    unmatchedKeys.push(rawKey);
  }

  return { core, customFields, unmatchedKeys };
}
