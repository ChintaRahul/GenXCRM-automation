import { Prisma, Role } from '@prisma/client';
import type { AuthUser } from '../types/auth-user.type';

// Org + role scope for Lead-based queries: SALES_REP sees only their own leads,
// MANAGER sees their team's, DIRECTOR (and any other role) sees the whole org.
export function buildLeadScopeFilter(caller: AuthUser): Prisma.LeadWhereInput {
  const orgFilter = caller.orgId ? { orgId: caller.orgId } : {};
  if (caller.role === Role.SALES_REP) return { ...orgFilter, assignedToId: caller.id };
  if (caller.role === Role.MANAGER) return { ...orgFilter, teamId: caller.teamId ?? undefined };
  return orgFilter;
}

// For models with a direct orgId plus a leadId FK (e.g. Invoice), where role
// tiering (SALES_REP -> own leads, MANAGER -> team) is expressed via the
// linked Lead's assignment, since Invoice itself has no assignedToId/teamId.
//
// isDeleted: false is baked in here rather than repeated at every call site — every
// Invoice query in invoices.service.ts goes through this single function, so this is
// the one place that needs to enforce "never show a soft-deleted invoice" (remove()
// soft-deletes rather than hard-deleting, mirroring the Lead pattern in CLAUDE.md rule 5).
export function buildInvoiceScopeFilter(caller: AuthUser): Prisma.InvoiceWhereInput {
  const orgFilter = caller.orgId ? { orgId: caller.orgId } : {};
  const base = { ...orgFilter, isDeleted: false };
  if (caller.role === Role.SALES_REP) return { ...base, lead: { assignedToId: caller.id } };
  if (caller.role === Role.MANAGER) return { ...base, lead: { teamId: caller.teamId ?? undefined } };
  return base;
}
