import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';

// Canonical (Administration > Roles & permissions) field-security toggle labels,
// per README §27, mapped to the real model field(s) each one masks. "Costing & margin"
// is a whole-record restriction (see isModuleFullyRestricted), not a field mask, so it
// has no entry here.
const FIELD_LABEL_TO_KEYS: Record<string, string[]> = {
  'Standard cost': ['cost'],
  'Minimum selling price': ['minPrice'],
  'Approval thresholds': ['min', 'max'],
  'Competitor pricing': ['competitor'],
  'Payment receipts': ['amount', 'received', 'balance'],
};

async function restrictedFieldKeys(prisma: PrismaService, caller: AuthUser, moduleKey: string): Promise<string[]> {
  if (!caller.orgId) return [];
  const role = caller.mfgRole ?? caller.role;
  const restrictions = await prisma.fieldPermission.findMany({
    where: { orgId: caller.orgId, moduleKey, isDeleted: false, restrictedToRoles: { has: role } },
  });
  return restrictions.flatMap((r) => FIELD_LABEL_TO_KEYS[r.fieldLabel] ?? []);
}

// Removes restricted fields on a single record before it leaves the service layer
// (API response or export) — enforced here, not only hidden in the UI, per CLAUDE.md's
// data-masking requirement.
export async function maskRestrictedFields<T extends Record<string, unknown>>(
  record: T,
  moduleKey: string,
  caller: AuthUser,
  prisma: PrismaService,
): Promise<T> {
  const keys = await restrictedFieldKeys(prisma, caller, moduleKey);
  if (!keys.length) return record;
  const masked = { ...record };
  for (const key of keys) delete (masked as Record<string, unknown>)[key];
  return masked;
}

export async function maskRestrictedFieldsMany<T extends Record<string, unknown>>(
  records: T[],
  moduleKey: string,
  caller: AuthUser,
  prisma: PrismaService,
): Promise<T[]> {
  if (!records.length) return records;
  const keys = await restrictedFieldKeys(prisma, caller, moduleKey);
  if (!keys.length) return records;
  return records.map((record) => {
    const masked = { ...record };
    for (const key of keys) delete (masked as Record<string, unknown>)[key];
    return masked;
  });
}

// Whole-record block (e.g. "Costing is restricted" — README §12) for roles without
// field access to a module's single all-or-nothing restriction, identified by fieldLabel.
export async function isModuleFullyRestricted(
  prisma: PrismaService,
  caller: AuthUser,
  moduleKey: string,
  fieldLabel: string,
): Promise<boolean> {
  if (!caller.orgId) return false;
  const role = caller.mfgRole ?? caller.role;
  const restriction = await prisma.fieldPermission.findFirst({
    where: { orgId: caller.orgId, moduleKey, fieldLabel, isDeleted: false, restrictedToRoles: { has: role } },
  });
  return !!restriction;
}
