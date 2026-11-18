import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';

export type RecordAccessScope = 'OWN' | 'TEAM' | 'ALL';
export type ModuleOp = 'create' | 'read' | 'update' | 'delete';

// Administration config modules. They have no RolePermission rows (the matrix only covers the
// domain modules) and their records aren't owned by anyone, so the matrix + owner scope don't
// apply: org admins (DIRECTOR role, which includes Super Admin) read and write them, Managers
// read only, and everyone else is denied.
const ADMIN_CONFIG_MODULES: ReadonlySet<string> = new Set([
  'approvalRules',
  'automationRules',
  'businessCalendar',
  'docTemplates',
  'erp',
  'fieldPermissions',
  'holidays',
  'masters',
  'rolePermissions',
  'slaPolicies',
]);

// Resolves the Prisma where-fragment that scopes a manufacturing module's records to
// what `caller` is allowed to see, per the org's RolePermission.recordAccess setting
// for caller.mfgRole + moduleKey (module keys match frontend/src/modules/registry.ts).
//
// Backward-compat fallback: a caller with no mfgRole (EdTech orgs, or a manufacturing
// user not yet assigned one) keeps the pre-Phase-5 behavior — SALES_REP sees only its
// own records, everyone else sees the whole org — so this is additive, not breaking,
// for anyone not yet migrated onto MfgRole.
export async function resolveOwnerScope(
  prisma: PrismaService,
  caller: AuthUser,
  moduleKey: string,
): Promise<Record<string, unknown>> {
  if (!caller.orgId) return {};
  if (ADMIN_CONFIG_MODULES.has(moduleKey)) return {};
  if (!caller.mfgRole) {
    return caller.role === Role.SALES_REP ? { ownerId: caller.id } : {};
  }
  const permission = await prisma.rolePermission.findFirst({
    where: { orgId: caller.orgId, role: caller.mfgRole, moduleKey, isDeleted: false },
  });
  const scope: RecordAccessScope = (permission?.recordAccess as RecordAccessScope | undefined) ?? 'OWN';
  if (scope === 'ALL') return {};
  if (scope === 'TEAM') {
    // A manager sees the team they belong to and any team they manage (a Member team can't hold its manager as a member).
    const managed = await prisma.team.findMany({ where: { orgId: caller.orgId, managerId: caller.id }, select: { id: true } });
    const teamIds = [...new Set([caller.teamId, ...managed.map((t) => t.id)].filter((id): id is string => Boolean(id)))];
    if (teamIds.length === 0) return { ownerId: caller.id };
    const teamMembers = await prisma.user.findMany({
      where: { orgId: caller.orgId, teamId: { in: teamIds } },
      select: { id: true },
    });
    return { ownerId: { in: [...new Set([caller.id, ...teamMembers.map((u) => u.id)])] } };
  }
  return { ownerId: caller.id };
}

// Whether `caller` may set/see the `owner` query filter and choose an arbitrary
// ownerId on create — i.e. whether their own scope is anything broader than OWN.
// Mirrors the legacy `caller.role !== Role.SALES_REP` checks this replaces.
export async function canActAcrossOwners(prisma: PrismaService, caller: AuthUser, moduleKey: string): Promise<boolean> {
  if (!caller.mfgRole) return caller.role !== Role.SALES_REP;
  if (ADMIN_CONFIG_MODULES.has(moduleKey)) return true;
  const permission = await prisma.rolePermission.findFirst({
    where: { orgId: caller.orgId ?? '', role: caller.mfgRole, moduleKey, isDeleted: false },
  });
  const scope: RecordAccessScope = (permission?.recordAccess as RecordAccessScope | undefined) ?? 'OWN';
  return scope !== 'OWN';
}

const OP_TO_FIELD = {
  create: 'canCreate',
  read: 'canRead',
  update: 'canUpdate',
  delete: 'canDelete',
} as const;

// Module keys the caller may read, so the UI can hide nav links they'd only 403 on. `null`
// means unrestricted (no mfgRole), mirroring assertModuleAccess's fallback.
export async function getReadableModuleKeys(prisma: PrismaService, caller: AuthUser): Promise<string[] | null> {
  if (!caller.mfgRole) return null;
  const rows = await prisma.rolePermission.findMany({
    where: { orgId: caller.orgId ?? '', role: caller.mfgRole, canRead: true, isDeleted: false },
    select: { moduleKey: true },
  });
  return rows.map((r) => r.moduleKey);
}

// What the caller may do per module (create / update / delete), so the UI hides buttons the server
// would refuse. `null` means unrestricted (no mfgRole). A module with no row allows nothing.
export type ModuleRights = { create: boolean; read: boolean; update: boolean; delete: boolean };
export async function getModuleRights(prisma: PrismaService, caller: AuthUser): Promise<Record<string, ModuleRights> | null> {
  if (!caller.mfgRole) return null;
  const rows = await prisma.rolePermission.findMany({
    where: { orgId: caller.orgId ?? '', role: caller.mfgRole, isDeleted: false },
    select: { moduleKey: true, canCreate: true, canRead: true, canUpdate: true, canDelete: true },
  });
  return Object.fromEntries(
    rows.map((r) => [r.moduleKey, { create: r.canCreate, read: r.canRead, update: r.canUpdate, delete: r.canDelete }]),
  );
}

// Enforces RolePermission's per-module CRUD matrix (canCreate/canRead/canUpdate/canDelete) —
// the actual gate behind Administration > Roles & Permissions' checkbox matrix, which until
// this was wired in had no effect: resolveOwnerScope/canActAcrossOwners only ever consulted
// recordAccess, never these flags. Called once, centrally, from ModulesController — every
// manufacturing module (domain and Administration config alike) registers through the same
// generic controller, so this is the single enforcement point for all of them.
//
// Backward-compat fallback: unrestricted when caller.mfgRole is unset, matching the
// permissive pre-Phase-5 baseline (no CRUD-matrix concept existed before this phase).
// A caller WITH an mfgRole but no matching RolePermission row is denied — a missing seed
// row is a configuration gap, and failing closed is the safer default for an access check.
export async function assertModuleAccess(
  prisma: PrismaService,
  caller: AuthUser,
  moduleKey: string,
  op: ModuleOp,
): Promise<void> {
  if (!caller.mfgRole) return;
  if (ADMIN_CONFIG_MODULES.has(moduleKey)) {
    const allowedConfig = caller.role === Role.DIRECTOR || (op === 'read' && caller.role === Role.MANAGER);
    if (!allowedConfig) throw new ForbiddenException(`Your role does not have '${op}' access to '${moduleKey}'.`);
    return;
  }
  const permission = await prisma.rolePermission.findFirst({
    where: { orgId: caller.orgId ?? '', role: caller.mfgRole, moduleKey, isDeleted: false },
  });
  const allowed = permission ? Boolean(permission[OP_TO_FIELD[op]]) : false;
  if (!allowed) {
    throw new ForbiddenException(`Your role does not have '${op}' access to '${moduleKey}'.`);
  }
}
