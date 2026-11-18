import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';
import type { ModuleListQuery } from '../module-adapter.interface';
import { canActAcrossOwners } from './record-access.util';

// Per-module description of which columns the shared list filters (status / owner / facets /
// date / value / SLA risk) apply to. A module only opts in to what it really has — e.g. a module
// without an owner column leaves `ownerField` unset and the owner filter is ignored for it.
export interface ModuleFilterConfig {
  readonly moduleKey: string;
  // SlaTimer.entityType; unset = no SLA concept, `slaRisk` is ignored.
  readonly entityType?: string;
  readonly statusField?: string;
  readonly ownerField?: string;
  readonly dateField?: string;
  readonly valueField?: string;
  // Columns that may be used as multi-select facets. Anything else in `facets` is dropped, so a
  // client can never filter on (or count by) an arbitrary column.
  readonly facetFields?: readonly string[];
}

export interface FacetOwner {
  id: string;
  name: string;
  count: number;
}

export interface ModuleFacets {
  total: number;
  status: Record<string, number>;
  owners: FacetOwner[];
  facets: Record<string, Record<string, number>>;
  slaRiskCount: number;
  // What this module supports, so the client only renders sections that will actually filter.
  capabilities: { owner: boolean; date: boolean; value: boolean; sla: boolean };
}

// Minimal Prisma-delegate surface used here; each service passes `this.prisma.<model>`.
export interface FacetDelegate {
  groupBy(args: { by: string[]; where: object; _count: { _all: true } }): Promise<Array<Record<string, unknown> & { _count: { _all: number } }>>;
  count(args: { where: object }): Promise<number>;
}

const DEFAULT_STATUS_FIELD = 'status';
const DEFAULT_DATE_FIELD = 'createdAt';
const DAY_MS = 86_400_000;
const PRESET_DAYS: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };

// Breached/at-risk is read straight from the open SlaTimer rows (the same source as the SLA pill
// in the list), so "SLA at risk" always agrees with what the row shows.
const SLA_RISK_STATUSES = ['At risk', 'Breached'];

function parseFacets(raw: string | undefined, allowed: readonly string[]): Record<string, string[]> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const result: Record<string, string[]> = {};
    for (const [key, values] of Object.entries(parsed)) {
      if (!allowed.includes(key) || !Array.isArray(values)) continue;
      const strings = values.filter((v): v is string => typeof v === 'string');
      if (strings.length) result[key] = strings;
    }
    return result;
  } catch {
    return {};
  }
}

function resolveDateRange(query: ModuleListQuery): { gte?: Date; lte?: Date } {
  const { datePreset, from, to } = query;
  if (datePreset === 'today') {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return { gte: start };
  }
  if (datePreset === 'mtd') {
    const now = new Date();
    return { gte: new Date(now.getFullYear(), now.getMonth(), 1) };
  }
  if (datePreset && PRESET_DAYS[datePreset]) {
    return { gte: new Date(Date.now() - PRESET_DAYS[datePreset] * DAY_MS) };
  }
  const range: { gte?: Date; lte?: Date } = {};
  if (from) range.gte = new Date(`${from}T00:00:00.000`);
  // `to` is a date the user picked, so it is inclusive of that whole day.
  if (to) range.lte = new Date(`${to}T23:59:59.999`);
  return range;
}

async function slaRiskEntityIds(prisma: PrismaService, orgId: string, entityType: string): Promise<string[]> {
  const timers = await prisma.slaTimer.findMany({
    where: {
      orgId,
      entityType,
      isDeleted: false,
      status: { not: 'Met' },
      OR: [{ status: { in: SLA_RISK_STATUSES } }, { dueAt: { lt: new Date() } }],
    },
    select: { entityId: true },
  });
  return [...new Set(timers.map((t) => t.entityId))];
}

// Returns the filter conditions as `{ AND: [...] }` (or `{}`), to be spread into a service's
// `where` next to its tenant scope. Filters AND across facets and OR within one (`in`). The
// caller's own tenant/owner scope is already in the surrounding `where`, so every condition here
// can only narrow it, never widen it.
export async function buildListFilters(
  prisma: PrismaService,
  query: ModuleListQuery,
  caller: AuthUser,
  config: ModuleFilterConfig,
): Promise<Record<string, unknown>> {
  const conditions: Record<string, unknown>[] = [];

  if (query.status?.length) {
    conditions.push({ [config.statusField ?? DEFAULT_STATUS_FIELD]: { in: query.status } });
  }

  if (config.ownerField && query.ownerId?.length && (await canActAcrossOwners(prisma, caller, config.moduleKey))) {
    conditions.push({ [config.ownerField]: { in: query.ownerId } });
  }

  for (const [field, values] of Object.entries(parseFacets(query.facets, config.facetFields ?? []))) {
    conditions.push({ [field]: { in: values } });
  }

  const range = resolveDateRange(query);
  if (range.gte || range.lte) conditions.push({ [config.dateField ?? DEFAULT_DATE_FIELD]: range });

  if (config.valueField && (query.valueMin !== undefined || query.valueMax !== undefined)) {
    conditions.push({
      [config.valueField]: {
        ...(query.valueMin !== undefined ? { gte: query.valueMin } : {}),
        ...(query.valueMax !== undefined ? { lte: query.valueMax } : {}),
      },
    });
  }

  if (query.slaRisk && config.entityType && caller.orgId) {
    conditions.push({ id: { in: await slaRiskEntityIds(prisma, caller.orgId, config.entityType) } });
  }

  return conditions.length ? { AND: conditions } : {};
}

// Live facet counts over `baseWhere` (tenant + role scope + search, but NOT the other filters), so
// options never disappear as the user narrows. Restricted/unlisted columns can't appear because
// only `config.facetFields` are counted.
export async function computeFacets(
  prisma: PrismaService,
  delegate: FacetDelegate,
  baseWhere: object,
  caller: AuthUser,
  config: ModuleFilterConfig,
): Promise<ModuleFacets> {
  const statusField = config.statusField ?? DEFAULT_STATUS_FIELD;
  const facetFields = config.facetFields ?? [];
  const acrossOwners = Boolean(config.ownerField) && (await canActAcrossOwners(prisma, caller, config.moduleKey));

  const count = (row: { _count: { _all: number } }) => row._count._all;
  const toCounts = (rows: Array<Record<string, unknown> & { _count: { _all: number } }>, field: string) =>
    Object.fromEntries(rows.filter((r) => r[field] != null).map((r) => [String(r[field]), count(r)]));

  const [total, statusRows, ownerRows, facetRows, riskIds] = await Promise.all([
    delegate.count({ where: baseWhere }),
    delegate.groupBy({ by: [statusField], where: baseWhere, _count: { _all: true } }),
    acrossOwners && config.ownerField
      ? delegate.groupBy({ by: [config.ownerField], where: baseWhere, _count: { _all: true } })
      : Promise.resolve([]),
    Promise.all(facetFields.map((field) => delegate.groupBy({ by: [field], where: baseWhere, _count: { _all: true } }))),
    config.entityType && caller.orgId ? slaRiskEntityIds(prisma, caller.orgId, config.entityType) : Promise.resolve([]),
  ]);

  const ownerCounts = ownerRows.filter((r) => r[config.ownerField as string] != null);
  const ownerIds = ownerCounts.map((r) => String(r[config.ownerField as string]));
  const users = ownerIds.length
    ? await prisma.user.findMany({ where: { id: { in: ownerIds }, orgId: caller.orgId ?? undefined }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(users.map((u) => [u.id, u.name]));

  const slaRiskCount = riskIds.length ? await delegate.count({ where: { AND: [baseWhere, { id: { in: riskIds } }] } }) : 0;

  return {
    total,
    status: toCounts(statusRows, statusField),
    owners: ownerCounts.map((r) => {
      const id = String(r[config.ownerField as string]);
      return { id, name: nameById.get(id) ?? id, count: count(r) };
    }),
    facets: Object.fromEntries(facetFields.map((field, i) => [field, toCounts(facetRows[i], field)])),
    slaRiskCount,
    capabilities: {
      owner: acrossOwners,
      date: true,
      value: Boolean(config.valueField),
      sla: Boolean(config.entityType),
    },
  };
}
