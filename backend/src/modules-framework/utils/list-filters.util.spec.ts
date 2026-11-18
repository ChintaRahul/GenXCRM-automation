import { Role } from '@prisma/client';
import { buildListFilters, computeFacets, type FacetDelegate, type ModuleFilterConfig } from './list-filters.util';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';

const config = {
  moduleKey: 'opps',
  entityType: 'Opportunity',
  statusField: 'stage',
  ownerField: 'ownerId',
  dateField: 'closeDate',
  valueField: 'value',
  facetFields: ['product', 'source'],
} satisfies ModuleFilterConfig;

const manager: AuthUser = { id: 'm1', name: 'M', email: 'm@t.com', role: Role.MANAGER, teamId: 't1', orgId: 'org-1' };
const rep: AuthUser = { id: 'r1', name: 'R', email: 'r@t.com', role: Role.SALES_REP, teamId: 't1', orgId: 'org-1' };

const prisma = {
  slaTimer: { findMany: jest.fn() },
  user: { findMany: jest.fn() },
  rolePermission: { findFirst: jest.fn() },
} as unknown as jest.Mocked<PrismaService>;
const base = { page: 1, limit: 20 };

describe('buildListFilters', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns no conditions when no filter is set', async () => {
    expect(await buildListFilters(prisma, base, manager, config)).toEqual({});
  });

  it('ORs within a facet (in) and ANDs across facets', async () => {
    const result = await buildListFilters(
      prisma,
      { ...base, status: ['Won', 'Lost'], facets: JSON.stringify({ product: ['Weighbridge', 'Conveyor'], source: ['Meta'] }) },
      manager,
      config,
    );
    expect(result).toEqual({
      AND: [
        { stage: { in: ['Won', 'Lost'] } },
        { product: { in: ['Weighbridge', 'Conveyor'] } },
        { source: { in: ['Meta'] } },
      ],
    });
  });

  it('drops facet fields that are not whitelisted (field security)', async () => {
    const result = await buildListFilters(prisma, { ...base, facets: JSON.stringify({ cost: ['1'], product: ['A'] }) }, manager, config);
    expect(result).toEqual({ AND: [{ product: { in: ['A'] } }] });
  });

  it('ignores malformed facets JSON', async () => {
    expect(await buildListFilters(prisma, { ...base, facets: '{not json' }, manager, config)).toEqual({});
  });

  it('applies the owner filter for a caller who can act across owners', async () => {
    const result = await buildListFilters(prisma, { ...base, ownerId: ['u9'] }, manager, config);
    expect(result).toEqual({ AND: [{ ownerId: { in: ['u9'] } }] });
  });

  it('ignores the owner filter for a SALES_REP (own-scope)', async () => {
    expect(await buildListFilters(prisma, { ...base, ownerId: ['u9'] }, rep, config)).toEqual({});
  });

  it('ignores the owner filter for a module without an owner column', async () => {
    const noOwner: ModuleFilterConfig = { moduleKey: 'products', facetFields: [] };
    expect(await buildListFilters(prisma, { ...base, ownerId: ['u9'] }, manager, noOwner)).toEqual({});
  });

  it('resolves a relative date preset on the module date field', async () => {
    const before = Date.now();
    const result = (await buildListFilters(prisma, { ...base, datePreset: '7d' }, manager, config)) as {
      AND: Array<{ closeDate: { gte: Date } }>;
    };
    const gte = result.AND[0].closeDate.gte.getTime();
    expect(gte).toBeLessThanOrEqual(before - 7 * 86_400_000 + 1000);
    expect(gte).toBeGreaterThan(before - 7 * 86_400_000 - 5000);
  });

  it('resolves the mtd preset to the first of the current month', async () => {
    const result = (await buildListFilters(prisma, { ...base, datePreset: 'mtd' }, manager, config)) as {
      AND: Array<{ closeDate: { gte: Date } }>;
    };
    const gte = result.AND[0].closeDate.gte;
    const now = new Date();
    expect(gte.getFullYear()).toBe(now.getFullYear());
    expect(gte.getMonth()).toBe(now.getMonth());
    expect(gte.getDate()).toBe(1);
    expect(gte.getHours()).toBe(0);
  });

  it('treats a custom "to" date as inclusive of that whole day', async () => {
    const result = (await buildListFilters(prisma, { ...base, datePreset: 'custom', from: '2026-09-01', to: '2026-09-30' }, manager, config)) as {
      AND: Array<{ closeDate: { gte: Date; lte: Date } }>;
    };
    expect(result.AND[0].closeDate.lte.getHours()).toBe(23);
    expect(result.AND[0].closeDate.gte.getDate()).toBe(1);
  });

  it('applies value min/max on the module value column', async () => {
    const result = await buildListFilters(prisma, { ...base, valueMin: 100, valueMax: 500 }, manager, config);
    expect(result).toEqual({ AND: [{ value: { gte: 100, lte: 500 } }] });
  });

  it('limits to SLA at-risk / breached entities, scoped to the caller org', async () => {
    (prisma.slaTimer.findMany as jest.Mock).mockResolvedValue([{ entityId: 'a' }, { entityId: 'a' }, { entityId: 'b' }]);
    const result = await buildListFilters(prisma, { ...base, slaRisk: true }, manager, config);
    expect(prisma.slaTimer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1', entityType: 'Opportunity' }) }),
    );
    expect(result).toEqual({ AND: [{ id: { in: ['a', 'b'] } }] });
  });
});

describe('computeFacets', () => {
  const delegate = { groupBy: jest.fn(), count: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.slaTimer.findMany as jest.Mock).mockResolvedValue([]);
  });

  it('counts status, owners (with names) and whitelisted facets over the base where', async () => {
    delegate.count.mockResolvedValue(5);
    delegate.groupBy.mockImplementation(({ by }: { by: string[] }) => {
      if (by[0] === 'stage') return Promise.resolve([{ stage: 'Won', _count: { _all: 2 } }, { stage: 'Lost', _count: { _all: 3 } }]);
      if (by[0] === 'ownerId') return Promise.resolve([{ ownerId: 'u1', _count: { _all: 4 } }, { ownerId: null, _count: { _all: 1 } }]);
      if (by[0] === 'product') return Promise.resolve([{ product: 'Conveyor', _count: { _all: 5 } }]);
      return Promise.resolve([]);
    });
    (prisma.user.findMany as jest.Mock).mockResolvedValue([{ id: 'u1', name: 'Asha' }]);

    const where = { orgId: 'org-1', isDeleted: false };
    const facets = await computeFacets(prisma, delegate as unknown as FacetDelegate, where, manager, config);

    expect(delegate.groupBy).toHaveBeenCalledWith(expect.objectContaining({ by: ['stage'], where }));
    expect(facets.total).toBe(5);
    expect(facets.status).toEqual({ Won: 2, Lost: 3 });
    expect(facets.owners).toEqual([{ id: 'u1', name: 'Asha', count: 4 }]);
    expect(facets.facets).toEqual({ product: { Conveyor: 5 }, source: {} });
    expect(facets.capabilities).toEqual({ owner: true, date: true, value: true, sla: true });
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1' }) }));
  });

  it('returns no owner facet for a SALES_REP', async () => {
    delegate.count.mockResolvedValue(0);
    delegate.groupBy.mockResolvedValue([]);
    const facets = await computeFacets(prisma, delegate as unknown as FacetDelegate, {}, rep, config);
    expect(facets.owners).toEqual([]);
    expect(facets.capabilities.owner).toBe(false);
    expect(delegate.groupBy).not.toHaveBeenCalledWith(expect.objectContaining({ by: ['ownerId'] }));
  });

  it('counts SLA-risk records within the base where', async () => {
    delegate.groupBy.mockResolvedValue([]);
    delegate.count.mockImplementation(({ where }: { where: object }) => Promise.resolve('AND' in where ? 2 : 9));
    (prisma.slaTimer.findMany as jest.Mock).mockResolvedValue([{ entityId: 'a' }]);
    const facets = await computeFacets(prisma, delegate as unknown as FacetDelegate, { orgId: 'org-1' }, manager, config);
    expect(facets.slaRiskCount).toBe(2);
  });
});
