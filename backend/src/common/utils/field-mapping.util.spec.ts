import { DEFAULT_CORE_FIELD_ALIASES, normalizeFieldOrder, resolveOrgFields } from './field-mapping.util';

describe('resolveOrgFields', () => {
  it('matches a core field alias case- and punctuation-insensitively', () => {
    const result = resolveOrgFields(
      { 'What City?': 'Pune' },
      { coreFieldAliases: { ...DEFAULT_CORE_FIELD_ALIASES, location: 'what_city?' }, customFieldDefs: [] },
    );
    expect(result.core).toEqual({ location: 'Pune' });
    expect(result.customFields).toEqual({});
  });

  it('matches a custom field definition and keys the result by the definition id', () => {
    const result = resolveOrgFields(
      { 'What type of organization do you run?': 'EdTech' },
      {
        coreFieldAliases: DEFAULT_CORE_FIELD_ALIASES,
        customFieldDefs: [{ id: 'cf-1', name: 'Organization Type', aliases: 'what_type_of_organization_do_you_run?' }],
      },
    );
    expect(result.customFields).toEqual({ 'cf-1': 'EdTech' });
    expect(result.core).toEqual({});
  });

  it('supports multiple comma-separated aliases per field', () => {
    const result = resolveOrgFields(
      { org_type: 'School' },
      {
        coreFieldAliases: DEFAULT_CORE_FIELD_ALIASES,
        customFieldDefs: [{ id: 'cf-1', name: 'Organization Type', aliases: 'business_type, org_type' }],
      },
    );
    expect(result.customFields).toEqual({ 'cf-1': 'School' });
  });

  it('skips blank raw values', () => {
    const result = resolveOrgFields(
      { location: '' },
      { coreFieldAliases: { ...DEFAULT_CORE_FIELD_ALIASES, location: 'location' }, customFieldDefs: [] },
    );
    expect(result.core).toEqual({});
  });

  it('first match wins when two raw keys alias to the same field', () => {
    const result = resolveOrgFields(
      { city: 'Pune', town: 'Mumbai' },
      { coreFieldAliases: { ...DEFAULT_CORE_FIELD_ALIASES, location: 'city, town' }, customFieldDefs: [] },
    );
    expect(result.core.location).toBe('Pune');
  });

  it('ignores raw keys with no configured alias, but reports them as unmatched', () => {
    const result = resolveOrgFields(
      { random_column: 'value' },
      { coreFieldAliases: DEFAULT_CORE_FIELD_ALIASES, customFieldDefs: [] },
    );
    expect(result.core).toEqual({});
    expect(result.customFields).toEqual({});
    expect(result.unmatchedKeys).toEqual(['random_column']);
  });

  it('does not report a blank raw value as unmatched', () => {
    const result = resolveOrgFields(
      { empty_column: '' },
      { coreFieldAliases: DEFAULT_CORE_FIELD_ALIASES, customFieldDefs: [] },
    );
    expect(result.unmatchedKeys).toEqual([]);
  });

  it('does not report a matched key as unmatched', () => {
    const result = resolveOrgFields(
      { location: 'Pune' },
      { coreFieldAliases: { ...DEFAULT_CORE_FIELD_ALIASES, location: 'location' }, customFieldDefs: [] },
    );
    expect(result.unmatchedKeys).toEqual([]);
  });
});

describe('normalizeFieldOrder', () => {
  const defs = [{ id: 'cf-1' }, { id: 'cf-2' }];

  it('keeps a valid saved order', () => {
    const saved = ['cf-2', 'stage', 'source', 'score', 'owner', 'createdAt', 'course', 'cf-1', 'altPhone', 'location', 'language', 'tags'];
    expect(normalizeFieldOrder(saved, defs)).toEqual(saved);
  });

  it('drops stale ids and appends fields that were never placed', () => {
    const result = normalizeFieldOrder(['gone', 'cf-2', 'course'], defs);
    expect(result.slice(0, 2)).toEqual(['cf-2', 'course']);
    expect(result).not.toContain('gone');
    expect(result).toEqual(expect.arrayContaining(['cf-1', 'altPhone', 'location', 'language', 'tags', 'stage', 'createdAt']));
  });

  it('never includes the fixed name/phone/email fields', () => {
    expect(normalizeFieldOrder(['name', 'phone', 'email'], defs)).not.toEqual(expect.arrayContaining(['name']));
  });
});
