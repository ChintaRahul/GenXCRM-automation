// e2e/mfg/db.ts - direct access to the ISOLATED E2E database, only for what no API route allows.
// The approvalRules module answers 403 to every role of the E2E org (it is not in MANUFACTURING_MODULE_KEYS, defect D-50), so the
// "no active Margin rules" case (TC-CST-007) has to toggle the rules in the database. Hard-guarded to localhost / genxcrm_test.
// Crash safety: the exact pre-state is written to a gitignored backup file BEFORE anything is deactivated and removed after the restore;
// restoreMarginRulesIfNeeded() re-applies a leftover file, so a killed worker / Ctrl-C heals on the next run.
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { E2E_ORG_SLUGS } from "./orgs";

interface Prisma {
  $queryRawUnsafe: <T>(sql: string, ...values: unknown[]) => Promise<T>;
  $executeRawUnsafe: (sql: string, ...values: unknown[]) => Promise<number>;
  $disconnect: () => Promise<void>;
}
interface Backup { orgId: string; ids: string[] }

// e2e/.auth/ is gitignored and, unlike e2e/test-results/, is not wiped at the start of a run.
const BACKUP_FILE = resolve(__dirname, "../.auth/margin-rules-backup.json");

const e2eDatabaseUrl = (): string => {
  const env = readFileSync(resolve(__dirname, "../../backend/.env.e2e.local"), "utf8");
  const url = /^DATABASE_URL="?([^"\r\n]+)"?/m.exec(env)?.[1];
  if (!url || !/^postgresql:\/\/[^@/?]+@localhost:\d+\/genxcrm_test(\?[^?]*)?$/.test(url) || /[?&]host=/.test(url)) {
    throw new Error("refusing to touch a database other than localhost/genxcrm_test");
  }
  return url;
};

const connect = (): Prisma => {
  // Required from backend/node_modules: the e2e package has no @prisma/client of its own (and must use the backend's generated client).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PrismaClient } = require("../../backend/node_modules/@prisma/client") as { PrismaClient: new (o: { datasources: { db: { url: string } } }) => Prisma };
  return new PrismaClient({ datasources: { db: { url: e2eDatabaseUrl() } } });
};

const reactivate = async (prisma: Prisma, ids: string[]): Promise<void> => {
  if (ids.length) await prisma.$executeRawUnsafe(`UPDATE "ApprovalRule" SET "isActive" = true WHERE id = ANY($1::text[])`, ids);
};

/** Idempotent recovery: re-activates the rules of a leftover backup file (a previous run died while they were off). Returns whether it restored. */
export const restoreMarginRulesIfNeeded = async (): Promise<boolean> => {
  if (!existsSync(BACKUP_FILE)) return false;
  const { ids } = JSON.parse(readFileSync(BACKUP_FILE, "utf8")) as Backup;
  const prisma = connect();
  try {
    await reactivate(prisma, ids);
  } finally {
    await prisma.$disconnect();
  }
  rmSync(BACKUP_FILE, { force: true });
  return true;
};

/** Deactivates every active, non-deleted Margin rule of the org (writing the backup first). Test seam for the crash probe; prefer withMarginRulesDisabled. */
export const deactivateMarginRules = async (orgId: string): Promise<string[]> => {
  await restoreMarginRulesIfNeeded(); // never overwrite an unrestored backup
  const prisma = connect();
  try {
    const ids = (await prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM "ApprovalRule" WHERE "orgId" = $1 AND type = 'Margin' AND "isActive" = true AND "isDeleted" = false`, orgId,
    )).map((r) => r.id);
    writeFileSync(`${BACKUP_FILE}.tmp`, JSON.stringify({ orgId, ids } satisfies Backup)); // atomic: a crash never leaves a half-written backup
    renameSync(`${BACKUP_FILE}.tmp`, BACKUP_FILE);
    await prisma.$executeRawUnsafe(`UPDATE "ApprovalRule" SET "isActive" = false WHERE id = ANY($1::text[])`, ids);
    return ids;
  } finally {
    await prisma.$disconnect();
  }
};

/** Runs `body` while the org's Margin rules are deactivated; the exact rows are restored afterwards (and from the backup file after a crash). */
export const withMarginRulesDisabled = async <T>(orgId: string, body: () => Promise<T>): Promise<T> => {
  await deactivateMarginRules(orgId);
  try {
    return await body();
  } finally {
    await restoreMarginRulesIfNeeded();
  }
};

/** Band of one rule (min, max, approver) for assertions. */
export const readApprovalRule = async (id: string): Promise<{ min: number; max: number; approverRole: string; type: string } | undefined> => {
  const prisma = connect();
  try {
    return (await prisma.$queryRawUnsafe<{ min: number; max: number; approverRole: string; type: string }[]>(
      `SELECT min, max, "approverRole", type FROM "ApprovalRule" WHERE id = $1`, id,
    ))[0];
  } finally {
    await prisma.$disconnect();
  }
};

/** Read-only: the SLA timers of one record (the API exposes only the latest one). Policy name + whether the timer is still open. */
export const slaTimersOf = async (entityId: string): Promise<{ name: string; open: boolean }[]> => {
  const prisma = connect();
  try {
    const rows = await prisma.$queryRawUnsafe<{ name: string; stoppedAt: Date | null }[]>(
      `SELECT p.name, t."stoppedAt" FROM "SlaTimer" t JOIN "SlaPolicy" p ON p.id = t."slaPolicyId" WHERE t."entityId" = $1 AND t."isDeleted" = false ORDER BY t."createdAt"`, entityId,
    );
    return rows.map((r) => ({ name: r.name, open: r.stoppedAt === null }));
  } finally {
    await prisma.$disconnect();
  }
};

// ---- Approval rule overrides (TC-APR-008): change one rule's approver / band, restore the exact original values afterwards. ----
export interface ApprovalRuleRow { id: string; type: string; min: number; max: number; approverRole: string; isActive: boolean }
interface RuleBackup { rules: ApprovalRuleRow[] }
const RULE_BACKUP_FILE = resolve(__dirname, "../.auth/approval-rules-backup.json");

/** Read-only: the org's non-deleted approval rules (the approvalRules API is 403 for every role, D-50). */
export const readOrgApprovalRules = async (orgId: string): Promise<ApprovalRuleRow[]> => {
  const prisma = connect();
  try {
    return await prisma.$queryRawUnsafe<ApprovalRuleRow[]>(
      `SELECT id, type, min, max, "approverRole", "isActive" FROM "ApprovalRule" WHERE "orgId" = $1 AND "isDeleted" = false ORDER BY type, min`, orgId,
    );
  } finally {
    await prisma.$disconnect();
  }
};

/** Idempotent recovery: writes the exact original values of a leftover backup file back (a previous run died while a rule was overridden). */
export const restoreApprovalRulesIfNeeded = async (): Promise<boolean> => {
  if (!existsSync(RULE_BACKUP_FILE)) return false;
  const { rules } = JSON.parse(readFileSync(RULE_BACKUP_FILE, "utf8")) as RuleBackup;
  const prisma = connect();
  try {
    for (const r of rules) {
      await prisma.$executeRawUnsafe(
        `UPDATE "ApprovalRule" SET "approverRole" = $2, min = $3, max = $4, "isActive" = $5 WHERE id = $1`, r.id, r.approverRole, r.min, r.max, r.isActive,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
  rmSync(RULE_BACKUP_FILE, { force: true });
  return true;
};

/**
 * Runs `body` while ONE rule of the org (found by type + band, e.g. Discount 5-10) has another approver; the exact original row values are saved
 * to a backup file first and restored in `finally` (and from the file after a crash). Returns what `body` returns.
 */
export const withApprovalRuleOverride = async <T>(
  orgId: string, rule: { type: string; min: number; max: number }, change: { approverRole: string }, body: () => Promise<T>,
): Promise<T> => {
  await restoreApprovalRulesIfNeeded(); // never overwrite an unrestored backup
  const prisma = connect();
  try {
    const rows = await prisma.$queryRawUnsafe<ApprovalRuleRow[]>(
      `SELECT id, type, min, max, "approverRole", "isActive" FROM "ApprovalRule" WHERE "orgId" = $1 AND type = $2 AND min = $3 AND max = $4 AND "isDeleted" = false`,
      orgId, rule.type, rule.min, rule.max,
    );
    if (rows.length !== 1 || !rows[0]) throw new Error(`expected exactly one ${rule.type} ${rule.min}-${rule.max} rule, found ${rows.length}`);
    writeFileSync(`${RULE_BACKUP_FILE}.tmp`, JSON.stringify({ rules: rows } satisfies RuleBackup)); // atomic
    renameSync(`${RULE_BACKUP_FILE}.tmp`, RULE_BACKUP_FILE);
    await prisma.$executeRawUnsafe(`UPDATE "ApprovalRule" SET "approverRole" = $2 WHERE id = $1`, rows[0].id, change.approverRole);
  } finally {
    await prisma.$disconnect();
  }
  try {
    return await body();
  } finally {
    await restoreApprovalRulesIfNeeded();
  }
};

/** Read-only: the roles a field-security toggle (e.g. 'Payment receipts' on 'payments') is restricted to, in the org of the given user. */
export const restrictedRolesOf = async (userEmail: string, moduleKey: string, fieldLabel: string): Promise<string[]> => {
  const prisma = connect();
  try {
    const rows = await prisma.$queryRawUnsafe<{ restrictedToRoles: string[] }[]>(
      `SELECT f."restrictedToRoles" FROM "FieldPermission" f JOIN "User" u ON u."orgId" = f."orgId" WHERE u.email = $1 AND f."moduleKey" = $2 AND f."fieldLabel" = $3 AND f."isDeleted" = false`,
      userEmail, moduleKey, fieldLabel,
    );
    return rows.flatMap((r) => r.restrictedToRoles);
  } finally {
    await prisma.$disconnect();
  }
};

/**
 * Test seam for D-104: no API route can set a coverage's status to Quoted / Negotiation / Renewed (UpdateCoverageDto has no `status`, no action
 * targets those statuses), so the cases that need such a coverage set the status of ONE throwaway coverage row directly. Guarded like the rest
 * of this file (localhost / genxcrm_test only).
 */
export const setCoverageStatus = async (coverageId: string, status: "Quoted" | "Negotiation" | "Renewed"): Promise<void> => {
  const prisma = connect();
  try {
    const changed = await prisma.$executeRawUnsafe(`UPDATE "Coverage" SET status = $2 WHERE id = $1`, coverageId, status);
    if (changed !== 1) throw new Error(`setCoverageStatus: expected to update exactly one coverage, updated ${changed}`);
  } finally {
    await prisma.$disconnect();
  }
};

/** Read-only: how long each SLA timer of one record runs (dueAt - startedAt, in ms) - the API only exposes the latest timer as a label. */
export const slaTimerWindows = async (entityId: string): Promise<{ name: string; windowMs: number; open: boolean }[]> => {
  const prisma = connect();
  try {
    const rows = await prisma.$queryRawUnsafe<{ name: string; windowMs: number; stoppedAt: Date | null }[]>(
      `SELECT p.name, (EXTRACT(EPOCH FROM (t."dueAt" - t."startedAt")) * 1000)::float8 AS "windowMs", t."stoppedAt" FROM "SlaTimer" t JOIN "SlaPolicy" p ON p.id = t."slaPolicyId" WHERE t."entityId" = $1 AND t."isDeleted" = false ORDER BY t."createdAt"`, entityId,
    );
    return rows.map((r) => ({ name: r.name, windowMs: Math.round(r.windowMs), open: r.stoppedAt === null }));
  } finally {
    await prisma.$disconnect();
  }
};

// ---- SLA specs (TC-SLA-*, TC-RPT-006, TC-DSH-*): read-only helpers plus ONE throwaway policy ----
// The slaPolicies / slaTimers modules answer 403 to every role (D-7), so policies are read here. To observe breaches inside a test the specs never
// shorten a SEEDED policy (older timers of other specs would breach and escalate with it); they INSERT an extra, uniquely named policy
// ("E2E-SLA-...") for the duration of one test, which only affects the records that test creates, and delete it (and its timers) in `finally`.
// Crash safety: the policy id is written to a gitignored backup file BEFORE the insert; restoreSlaThrowawayIfNeeded() removes leftovers.
export interface SlaPolicyTarget { cond: string; val: number; unit: "minutes" | "hours" | "days" }
export interface SlaPolicyEscalation { at: number; who: string; channels: string[] }
export interface SlaPolicyRow {
  name: string; moduleKey: string; startEvent: string; stopEvent: string; calendarType: string;
  targets: SlaPolicyTarget[]; escalationLevels: SlaPolicyEscalation[]; pauseStatuses: string[]; isActive: boolean;
}
export interface ThrowawaySlaPolicyDef {
  moduleKey: string; startEvent: string; stopEvent: string; calendarType: "24 x 7" | "Calendar days" | "Business hours";
  targets: SlaPolicyTarget[]; escalationLevels: SlaPolicyEscalation[];
}
export const THROWAWAY_SLA_PREFIX = "E2E-SLA-";
const SLA_BACKUP_FILE = resolve(__dirname, "../.auth/sla-throwaway-backup.json");

/** Read-only: the seeded (non-throwaway) SLA policies of the org of `userEmail`, ordered as seeded (creation order). */
export const readSlaPolicies = async (userEmail: string): Promise<SlaPolicyRow[]> => {
  const prisma = connect();
  try {
    return await prisma.$queryRawUnsafe<SlaPolicyRow[]>(
      `SELECT p.name, p."moduleKey", p."startEvent", p."stopEvent", p."calendarType", p.targets, p."escalationLevels", p."pauseStatuses", p."isActive"
       FROM "SlaPolicy" p JOIN "User" u ON u."orgId" = p."orgId" WHERE u.email = $1 AND p."isDeleted" = false AND p.name NOT LIKE $2 ORDER BY p."createdAt", p.name`,
      userEmail, `${THROWAWAY_SLA_PREFIX}%`,
    );
  } finally {
    await prisma.$disconnect();
  }
};

/** Idempotent recovery: deletes the throwaway policy (and its timers) of a leftover backup file. Returns whether it cleaned up. */
export const restoreSlaThrowawayIfNeeded = async (): Promise<boolean> => {
  if (!existsSync(SLA_BACKUP_FILE)) return false;
  const { ids } = JSON.parse(readFileSync(SLA_BACKUP_FILE, "utf8")) as { ids: string[] };
  const prisma = connect();
  try {
    // The name guard makes sure a corrupted file can never delete a seeded policy.
    await prisma.$executeRawUnsafe(`DELETE FROM "SlaTimer" WHERE "slaPolicyId" IN (SELECT id FROM "SlaPolicy" WHERE id = ANY($1::text[]) AND name LIKE $2)`, ids, `${THROWAWAY_SLA_PREFIX}%`);
    await prisma.$executeRawUnsafe(`DELETE FROM "SlaPolicy" WHERE id = ANY($1::text[]) AND name LIKE $2`, ids, `${THROWAWAY_SLA_PREFIX}%`);
  } finally {
    await prisma.$disconnect();
  }
  rmSync(SLA_BACKUP_FILE, { force: true });
  return true;
};

/** Runs `body` while an extra active SLA policy `name` exists in the org of `userEmail`; it is removed again afterwards (and from the backup file after a crash). */
export const withThrowawaySlaPolicy = async <T>(
  userEmail: string, name: string, def: ThrowawaySlaPolicyDef, body: (policyId: string) => Promise<T>,
): Promise<T> => {
  if (!name.startsWith(THROWAWAY_SLA_PREFIX)) throw new Error(`throwaway SLA policy names must start with ${THROWAWAY_SLA_PREFIX}`);
  await restoreSlaThrowawayIfNeeded(); // never overwrite an unrestored backup
  const id = randomUUID();
  writeFileSync(SLA_BACKUP_FILE, JSON.stringify({ ids: [id] }));
  const prisma = connect();
  try {
    const inserted = await prisma.$executeRawUnsafe(
      `INSERT INTO "SlaPolicy" (id, "orgId", "moduleKey", name, "startEvent", "stopEvent", "calendarType", targets, "escalationLevels", "pauseStatuses", "isActive", "isDeleted", "createdAt", "updatedAt")
       SELECT $2, u."orgId", $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, ARRAY[]::text[], true, false, now(), now() FROM "User" u WHERE u.email = $1`,
      userEmail, id, def.moduleKey, name, def.startEvent, def.stopEvent, def.calendarType, JSON.stringify(def.targets), JSON.stringify(def.escalationLevels),
    );
    if (inserted !== 1) throw new Error(`withThrowawaySlaPolicy: user ${userEmail} not found`);
  } finally {
    await prisma.$disconnect();
  }
  try {
    return await body(id);
  } finally {
    await restoreSlaThrowawayIfNeeded();
  }
};

/** Edits the targets of the throwaway policy (what an admin edit of a policy target does); refuses any policy that is not the backed-up throwaway. */
export const setThrowawaySlaTargets = async (policyId: string, targets: SlaPolicyTarget[]): Promise<void> => {
  const prisma = connect();
  try {
    const changed = await prisma.$executeRawUnsafe(`UPDATE "SlaPolicy" SET targets = $2::jsonb, "updatedAt" = now() WHERE id = $1 AND name LIKE $3`, policyId, JSON.stringify(targets), `${THROWAWAY_SLA_PREFIX}%`);
    if (changed !== 1) throw new Error(`setThrowawaySlaTargets: ${policyId} is not a throwaway policy`);
  } finally {
    await prisma.$disconnect();
  }
};

/**
 * Housekeeping for the shared E2E database: SLA timers pile up across runs (thousands of open rows make one SLA tick take ~35 s). Deletes the timers of the two
 * Manufacturing E2E orgs that were created more than `olderThanHours` ago, except those of a throwaway E2E-SLA- policy (a running spec's). Returns the count.
 * Pass 0 only when no spec is running (auth.setup does); a positive value keeps recent timers.
 */
export const pruneStaleSlaTimers = async (olderThanHours = 2): Promise<number> => {
  if (!Number.isFinite(olderThanHours) || olderThanHours < 0) throw new Error("pruneStaleSlaTimers: olderThanHours must be >= 0 (0 = every timer of the E2E orgs)");
  const prisma = connect();
  try {
    return await prisma.$executeRawUnsafe(
      `DELETE FROM "SlaTimer" WHERE "orgId" IN (SELECT id FROM "Organization" WHERE slug = ANY($1::text[]))
       AND "createdAt" < now() - make_interval(secs => $2::float8)
       AND "slaPolicyId" NOT IN (SELECT id FROM "SlaPolicy" WHERE name LIKE $3)`,
      [...E2E_ORG_SLUGS], olderThanHours * 3600, `${THROWAWAY_SLA_PREFIX}%`,
    );
  } finally {
    await prisma.$disconnect();
  }
};

export interface SlaTimerDetail { name: string; status: string; open: boolean; windowMs: number; lastEscalationLevel: number; updatedAt: Date; startedAt: Date }
/** Read-only: every SLA timer of one record with its stored state (the API only exposes the latest one as a label). */
export const slaTimerDetail = async (entityId: string): Promise<SlaTimerDetail[]> => {
  const prisma = connect();
  try {
    const rows = await prisma.$queryRawUnsafe<(Omit<SlaTimerDetail, "open"> & { stoppedAt: Date | null })[]>(
      `SELECT p.name, t.status, t."stoppedAt", (EXTRACT(EPOCH FROM (t."dueAt" - t."startedAt")) * 1000)::float8 AS "windowMs", t."lastEscalationLevel", t."updatedAt", t."startedAt"
       FROM "SlaTimer" t JOIN "SlaPolicy" p ON p.id = t."slaPolicyId" WHERE t."entityId" = $1 AND t."isDeleted" = false ORDER BY t."createdAt"`, entityId,
    );
    return rows.map(({ stoppedAt, ...r }) => ({ ...r, open: stoppedAt === null, windowMs: Math.round(r.windowMs) }));
  } finally {
    await prisma.$disconnect();
  }
};

/** Read-only: ReportSchedule rows (the delivery log) of one report, and the number of AutomationRun rows of the org of `userEmail`. */
export const reportScheduleRows = async (reportId: string): Promise<{ status: string; recipientsSentTo: string | null }[]> => {
  const prisma = connect();
  try {
    return await prisma.$queryRawUnsafe<{ status: string; recipientsSentTo: string | null }[]>(`SELECT status, "recipientsSentTo" FROM "ReportSchedule" WHERE "reportId" = $1`, reportId);
  } finally {
    await prisma.$disconnect();
  }
};
export const automationRunCount = async (userEmail: string): Promise<number> => {
  const prisma = connect();
  try {
    const [row] = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM "AutomationRun" r JOIN "AutomationRule" a ON a.id = r."automationRuleId" JOIN "User" u ON u."orgId" = a."orgId" WHERE u.email = $1`, userEmail,
    );
    return row?.n ?? 0;
  } finally {
    await prisma.$disconnect();
  }
};

// ---- Administration config specs (TC-ADM-*): guarded mutation of the org's permission matrix, field security, business calendar, stage master + throwaway records ----
// The Administration modules (masters, rolePermissions, fieldPermissions, businessCalendar, holidays, docTemplates, automationRules) answer 403 to every role of the
// E2E org (D-124), so the EFFECT of a config change can only be tested by changing the row in the isolated database. Same safety net as the SLA throwaway:
// the exact pre-state of every touched row (and the ids of created rows) is written to a gitignored backup file BEFORE the first mutation and restored in `finally`;
// restoreAdminConfigIfNeeded() re-applies a leftover file (beforeAll of the adm spec + auth.setup.ts), so a killed run heals on the next one.
export const E2E_ADMIN_PREFIX = "E2E-";
const ADMIN_BACKUP_FILE = resolve(__dirname, "../.auth/admin-config-backup.json");
interface RolePermissionRow { id: string; recordAccess: string; canCreate: boolean; canRead: boolean; canUpdate: boolean; canDelete: boolean; canExport: boolean; isDeleted: boolean }
interface AdminBackup {
  orgId: string;
  rolePermissions: RolePermissionRow[];
  fieldPermissions: { id: string; restrictedToRoles: string[] }[];
  calendars: { id: string; timezone: string; days: unknown }[];
  masterValues: { id: string; numericValue: number | null; isActive: boolean }[];
  created: { masterValues: string[]; holidays: string[]; templates: string[] };
}
export interface AdminConfigChange {
  rolePermission?: { role: string; moduleKey: string; set: Partial<Omit<RolePermissionRow, "id" | "isDeleted">> };
  /** Removes (`allowRole`) or adds (`restrictRole`) one MfgRole in the restrictedToRoles of the toggle `fieldLabel`. */
  fieldPermission?: { fieldLabel: string; allowRole?: string; restrictRole?: string };
  /** Opens / closes one weekday of the org's business calendar. */
  calendarDay?: { day: "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun"; isOpen: boolean };
  stageProbability?: { stage: string; numericValue: number };
  /** Rows to create; every value / name must start with E2E_ADMIN_PREFIX (that is also the delete guard). */
  masterValues?: { category: string; value: string }[];
  holidays?: { date: string; name: string }[];
  templates?: { name: string; numberingPattern: string }[];
}

const orgOf = async (prisma: Prisma, userEmail: string): Promise<string> => {
  const [row] = await prisma.$queryRawUnsafe<{ orgId: string | null }[]>(`SELECT "orgId" FROM "User" WHERE email = $1`, userEmail);
  if (!row?.orgId) throw new Error(`no org for user ${userEmail}`);
  return row.orgId;
};

/** Idempotent recovery: re-applies the exact pre-state of a leftover backup file and deletes the E2E- rows it created. Returns whether it restored. */
export const restoreAdminConfigIfNeeded = async (): Promise<boolean> => {
  if (!existsSync(ADMIN_BACKUP_FILE)) return false;
  const b = JSON.parse(readFileSync(ADMIN_BACKUP_FILE, "utf8")) as AdminBackup;
  const prisma = connect();
  try {
    for (const r of b.rolePermissions) {
      await prisma.$executeRawUnsafe(
        `UPDATE "RolePermission" SET "recordAccess" = $2, "canCreate" = $3, "canRead" = $4, "canUpdate" = $5, "canDelete" = $6, "canExport" = $7, "isDeleted" = $8 WHERE id = $1 AND "orgId" = $9`,
        r.id, r.recordAccess, r.canCreate, r.canRead, r.canUpdate, r.canDelete, r.canExport, r.isDeleted, b.orgId,
      );
    }
    for (const f of b.fieldPermissions) {
      await prisma.$executeRawUnsafe(`UPDATE "FieldPermission" SET "restrictedToRoles" = $2::text[] WHERE id = $1 AND "orgId" = $3`, f.id, f.restrictedToRoles, b.orgId);
    }
    for (const c of b.calendars) {
      await prisma.$executeRawUnsafe(`UPDATE "BusinessCalendar" SET timezone = $2, days = $3::jsonb WHERE id = $1 AND "orgId" = $4`, c.id, c.timezone, JSON.stringify(c.days), b.orgId);
    }
    for (const m of b.masterValues) {
      await prisma.$executeRawUnsafe(`UPDATE "MasterValue" SET "numericValue" = $2, "isActive" = $3 WHERE id = $1 AND "orgId" = $4`, m.id, m.numericValue, m.isActive, b.orgId);
    }
    // The prefix guard makes sure a corrupted file can never delete a seeded row.
    const like = `${E2E_ADMIN_PREFIX}%`;
    await prisma.$executeRawUnsafe(`DELETE FROM "MasterValue" WHERE id = ANY($1::text[]) AND value LIKE $2 AND "orgId" = $3`, b.created.masterValues, like, b.orgId);
    await prisma.$executeRawUnsafe(`DELETE FROM "Holiday" WHERE id = ANY($1::text[]) AND name LIKE $2 AND "orgId" = $3`, b.created.holidays, like, b.orgId);
    await prisma.$executeRawUnsafe(`DELETE FROM "DocumentTemplate" WHERE id = ANY($1::text[]) AND name LIKE $2 AND "orgId" = $3`, b.created.templates, like, b.orgId);
  } finally {
    await prisma.$disconnect();
  }
  rmSync(ADMIN_BACKUP_FILE, { force: true });
  return true;
};

/**
 * Runs `body` while the org of `userEmail` has the config `change` applied (permission row, field-security toggle, calendar day, stage probability and/or
 * throwaway E2E- rows); everything is restored to the exact original values afterwards (and from the backup file after a crash).
 */
export const withAdminConfig = async <T>(userEmail: string, change: AdminConfigChange, body: () => Promise<T>): Promise<T> => {
  await restoreAdminConfigIfNeeded(); // never overwrite an unrestored backup
  const names = [...(change.masterValues ?? []).map((m) => m.value), ...(change.holidays ?? []).map((h) => h.name), ...(change.templates ?? []).map((t) => t.name)];
  for (const name of names) {
    if (!name.startsWith(E2E_ADMIN_PREFIX)) throw new Error(`created admin rows must start with ${E2E_ADMIN_PREFIX} (got '${name}')`);
  }
  const backup: AdminBackup = { orgId: "", rolePermissions: [], fieldPermissions: [], calendars: [], masterValues: [], created: { masterValues: [], holidays: [], templates: [] } };
  const prisma = connect();
  try {
    const orgId = await orgOf(prisma, userEmail);
    backup.orgId = orgId;
    const rp = change.rolePermission;
    if (rp) {
      backup.rolePermissions = await prisma.$queryRawUnsafe<RolePermissionRow[]>(
        `SELECT id, "recordAccess", "canCreate", "canRead", "canUpdate", "canDelete", "canExport", "isDeleted" FROM "RolePermission" WHERE "orgId" = $1 AND role = $2 AND "moduleKey" = $3 AND "isDeleted" = false`, orgId, rp.role, rp.moduleKey,
      );
      if (backup.rolePermissions.length !== 1) throw new Error(`expected exactly one ${rp.role}/${rp.moduleKey} permission row, found ${backup.rolePermissions.length}`);
    }
    const fp = change.fieldPermission;
    if (fp) {
      backup.fieldPermissions = await prisma.$queryRawUnsafe<{ id: string; restrictedToRoles: string[] }[]>(
        `SELECT id, "restrictedToRoles" FROM "FieldPermission" WHERE "orgId" = $1 AND "fieldLabel" = $2 AND "isDeleted" = false`, orgId, fp.fieldLabel,
      );
      if (backup.fieldPermissions.length !== 1) throw new Error(`expected exactly one '${fp.fieldLabel}' field permission, found ${backup.fieldPermissions.length}`);
    }
    if (change.calendarDay) {
      backup.calendars = await prisma.$queryRawUnsafe<{ id: string; timezone: string; days: unknown }[]>(`SELECT id, timezone, days FROM "BusinessCalendar" WHERE "orgId" = $1 AND "isDeleted" = false`, orgId);
      if (backup.calendars.length !== 1) throw new Error(`expected exactly one business calendar, found ${backup.calendars.length}`);
    }
    if (change.stageProbability) {
      backup.masterValues = await prisma.$queryRawUnsafe<{ id: string; numericValue: number | null; isActive: boolean }[]>(
        `SELECT id, "numericValue", "isActive" FROM "MasterValue" WHERE "orgId" = $1 AND category = 'stages' AND value = $2 AND "isDeleted" = false`, orgId, change.stageProbability.stage,
      );
      if (backup.masterValues.length !== 1) throw new Error(`expected exactly one '${change.stageProbability.stage}' stage master, found ${backup.masterValues.length}`);
    }
    // Ids of the rows to create are chosen (and persisted) before the first write.
    const newMasters = (change.masterValues ?? []).map((m) => ({ ...m, id: randomUUID() }));
    const newHolidays = (change.holidays ?? []).map((h) => ({ ...h, id: randomUUID() }));
    const newTemplates = (change.templates ?? []).map((t) => ({ ...t, id: randomUUID() }));
    backup.created = { masterValues: newMasters.map((m) => m.id), holidays: newHolidays.map((h) => h.id), templates: newTemplates.map((t) => t.id) };
    writeFileSync(`${ADMIN_BACKUP_FILE}.tmp`, JSON.stringify(backup)); // atomic: a crash never leaves a half-written backup
    renameSync(`${ADMIN_BACKUP_FILE}.tmp`, ADMIN_BACKUP_FILE);

    if (rp) {
      const columns = ["recordAccess", "canCreate", "canRead", "canUpdate", "canDelete", "canExport"];
      for (const [k, v] of Object.entries(rp.set)) {
        if (!columns.includes(k)) throw new Error(`unknown permission column ${k}`);
        await prisma.$executeRawUnsafe(`UPDATE "RolePermission" SET "${k}" = $2 WHERE id = $1`, backup.rolePermissions[0]?.id, v);
      }
    }
    if (fp) {
      const current = backup.fieldPermissions[0]?.restrictedToRoles ?? [];
      const next = [...current.filter((r) => r !== (fp.allowRole ?? "")), ...(fp.restrictRole && !current.includes(fp.restrictRole) ? [fp.restrictRole] : [])];
      await prisma.$executeRawUnsafe(`UPDATE "FieldPermission" SET "restrictedToRoles" = $2::text[] WHERE id = $1`, backup.fieldPermissions[0]?.id, next);
    }
    if (change.calendarDay) {
      const { day, isOpen } = change.calendarDay;
      const cal = backup.calendars[0];
      const days = (cal?.days as { day: string; isOpen: boolean }[]).map((d) => (d.day === day ? { ...d, isOpen } : d));
      await prisma.$executeRawUnsafe(`UPDATE "BusinessCalendar" SET days = $2::jsonb WHERE id = $1`, cal?.id, JSON.stringify(days));
    }
    if (change.stageProbability) {
      await prisma.$executeRawUnsafe(`UPDATE "MasterValue" SET "numericValue" = $2 WHERE id = $1`, backup.masterValues[0]?.id, change.stageProbability.numericValue);
    }
    for (const m of newMasters) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "MasterValue" (id, "orgId", category, value, label, "sortOrder", "isActive", "isDeleted", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $4, 999, true, false, now(), now())`, m.id, orgId, m.category, m.value,
      );
    }
    for (const h of newHolidays) {
      await prisma.$executeRawUnsafe(`INSERT INTO "Holiday" (id, "orgId", date, name, "isDeleted", "createdAt", "updatedAt") VALUES ($1, $2, $3::timestamp, $4, false, now(), now())`, h.id, orgId, h.date, h.name);
    }
    for (const t of newTemplates) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "DocumentTemplate" (id, "orgId", name, "numberingPattern", "isDeleted", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, false, now(), now())`, t.id, orgId, t.name, t.numberingPattern,
      );
    }
  } catch (e: unknown) {
    await prisma.$disconnect();
    await restoreAdminConfigIfNeeded(); // a half-applied change must not survive
    throw e;
  }
  await prisma.$disconnect();
  try {
    return await body();
  } finally {
    await restoreAdminConfigIfNeeded();
  }
};

/** Deletes E2E- masters / holidays / templates of the org of `userEmail` that a UI attempt may have created (test-owned rows only). */
export const purgeE2eAdminRecords = async (userEmail: string): Promise<void> => {
  const prisma = connect();
  try {
    const orgId = await orgOf(prisma, userEmail);
    const like = `${E2E_ADMIN_PREFIX}%`;
    await prisma.$executeRawUnsafe(`DELETE FROM "MasterValue" WHERE "orgId" = $1 AND value LIKE $2`, orgId, like);
    await prisma.$executeRawUnsafe(`DELETE FROM "Holiday" WHERE "orgId" = $1 AND name LIKE $2`, orgId, like);
    await prisma.$executeRawUnsafe(`DELETE FROM "DocumentTemplate" WHERE "orgId" = $1 AND name LIKE $2`, orgId, like);
  } finally {
    await prisma.$disconnect();
  }
};

export interface AdminDefaults {
  masterValues: { category: string; value: string; label: string; numericValue: number | null; sortOrder: number; isActive: boolean }[];
  rolePermissions: { role: string; moduleKey: string; recordAccess: string; canCreate: boolean; canRead: boolean; canUpdate: boolean; canDelete: boolean; canExport: boolean }[];
  fieldPermissions: { moduleKey: string; fieldLabel: string; restrictedToRoles: string[] }[];
  approvalRuleCount: number;
  slaPolicyCount: number;
  calendar: { timezone: string; days: { day: string; isOpen: boolean; from: string; to: string }[] }[];
  holidays: { date: string; name: string }[];
  reports: { category: string; name: string }[];
}
/** Read-only: the seeded Manufacturing defaults of the org of `userEmail` (E2E- throwaway rows, SLA throwaways and user-owned reports are left out). */
export const readAdminDefaults = async (userEmail: string): Promise<AdminDefaults> => {
  const prisma = connect();
  try {
    const orgId = await orgOf(prisma, userEmail);
    const like = `${E2E_ADMIN_PREFIX}%`;
    const q = <T>(sql: string, ...v: unknown[]): Promise<T[]> => prisma.$queryRawUnsafe<T[]>(sql, orgId, ...v);
    const [approvalRules, slaPolicies] = await Promise.all([
      q<{ n: number }>(`SELECT count(*)::int AS n FROM "ApprovalRule" WHERE "orgId" = $1 AND "isDeleted" = false`),
      q<{ n: number }>(`SELECT count(*)::int AS n FROM "SlaPolicy" WHERE "orgId" = $1 AND "isDeleted" = false AND name NOT LIKE $2`, `${THROWAWAY_SLA_PREFIX}%`),
    ]);
    return {
      masterValues: await q(`SELECT category, value, label, "numericValue", "sortOrder", "isActive" FROM "MasterValue" WHERE "orgId" = $1 AND "isDeleted" = false AND value NOT LIKE $2 ORDER BY category, "sortOrder", value`, like),
      rolePermissions: await q(`SELECT role, "moduleKey", "recordAccess", "canCreate", "canRead", "canUpdate", "canDelete", "canExport" FROM "RolePermission" WHERE "orgId" = $1 AND "isDeleted" = false ORDER BY role, "moduleKey"`),
      fieldPermissions: await q(`SELECT "moduleKey", "fieldLabel", "restrictedToRoles" FROM "FieldPermission" WHERE "orgId" = $1 AND "isDeleted" = false ORDER BY "fieldLabel"`),
      approvalRuleCount: approvalRules[0]?.n ?? NaN,
      slaPolicyCount: slaPolicies[0]?.n ?? NaN,
      calendar: await q(`SELECT timezone, days FROM "BusinessCalendar" WHERE "orgId" = $1 AND "isDeleted" = false ORDER BY "createdAt"`),
      holidays: await q(`SELECT to_char(date, 'YYYY-MM-DD') AS date, name FROM "Holiday" WHERE "orgId" = $1 AND "isDeleted" = false AND name NOT LIKE $2 ORDER BY date, name`, like),
      reports: await q(`SELECT category, name FROM "Report" WHERE "orgId" = $1 AND "isDeleted" = false AND "ownerId" IS NULL ORDER BY category, name`),
    };
  } finally {
    await prisma.$disconnect();
  }
};

/** Read-only: E2E- holidays / document templates and the business calendar days of the org of `userEmail`, plus the number of nurturing sequences (a lead import must not trigger sends). */
export const readAdminExtras = async (userEmail: string): Promise<{
  calendarDays: { day: string; isOpen: boolean }[]; holidays: { date: string; name: string }[]; templates: { name: string; numberingPattern: string }[]; nurturingSequences: number;
}> => {
  const prisma = connect();
  try {
    const orgId = await orgOf(prisma, userEmail);
    const [cal] = await prisma.$queryRawUnsafe<{ days: { day: string; isOpen: boolean }[] }[]>(`SELECT days FROM "BusinessCalendar" WHERE "orgId" = $1 AND "isDeleted" = false`, orgId);
    const [seq] = await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "NurturingSequence" WHERE "orgId" = $1`, orgId);
    return {
      calendarDays: cal?.days ?? [],
      holidays: await prisma.$queryRawUnsafe(`SELECT to_char(date, 'YYYY-MM-DD') AS date, name FROM "Holiday" WHERE "orgId" = $1 AND "isDeleted" = false AND name LIKE 'E2E-%' ORDER BY date`, orgId),
      templates: await prisma.$queryRawUnsafe(`SELECT name, "numberingPattern" FROM "DocumentTemplate" WHERE "orgId" = $1 AND "isDeleted" = false AND name LIKE 'E2E-%'`, orgId),
      nurturingSequences: seq?.n ?? NaN,
    };
  } finally {
    await prisma.$disconnect();
  }
};

/** Read-only: the soft-delete flag of one row (undefined when the row does not exist). Tables are an allowlist, never caller-built SQL. */
export type SoftDeleteTable = "MfgLead" | "Account" | "Contact" | "Opportunity" | "Quotation" | "Product" | "PurchaseOrder" | "Rfq" | "SiteVisit" | "Evaluation" | "MfgActivity" | "CostingSheet";
const SOFT_DELETE_TABLES: readonly string[] = ["MfgLead", "Account", "Contact", "Opportunity", "Quotation", "Product", "PurchaseOrder", "Rfq", "SiteVisit", "Evaluation", "MfgActivity", "CostingSheet"];
export const isDeletedOf = async (table: SoftDeleteTable, id: string): Promise<boolean | undefined> => {
  if (!SOFT_DELETE_TABLES.includes(table)) throw new Error(`isDeletedOf: table ${table} is not allowed`);
  const prisma = connect();
  try {
    const rows = await prisma.$queryRawUnsafe<{ isDeleted: boolean }[]>(`SELECT "isDeleted" FROM "${table}" WHERE id = $1`, id);
    return rows[0]?.isDeleted;
  } finally {
    await prisma.$disconnect();
  }
};

/**
 * Test seam for TC-GEN-008: the only notification producer is the SLA engine (slow, wall-clock), so an in-app notification for one E2E user is inserted
 * directly (same row the SLA engine writes). Restricted: only for `mfg.*@genxcrm-e2e.example` users and only with a title starting 'NTF-'.
 * Returns the new id; remove it with deleteNotification.
 */
const NTF_USER = "mfg.%@genxcrm-e2e.example";
export const NOTIFICATION_TITLE_PREFIX = "NTF-";
export const insertNotification = async (userEmail: string, n: { title: string; body: string; link: string }): Promise<string> => {
  if (!n.title.startsWith(NOTIFICATION_TITLE_PREFIX)) throw new Error(`insertNotification: title must start with '${NOTIFICATION_TITLE_PREFIX}'`);
  const prisma = connect();
  try {
    const id = randomUUID();
    const inserted = await prisma.$executeRawUnsafe(
      `INSERT INTO "Notification" (id, "orgId", "userId", title, body, link, "isRead", "createdAt") SELECT $1, u."orgId", u.id, $3, $4, $5, false, now() FROM "User" u WHERE u.email = $2 AND u.email LIKE $6`,
      id, userEmail, n.title, n.body, n.link, NTF_USER,
    );
    if (inserted !== 1) throw new Error(`insertNotification: no E2E user ${userEmail}`);
    return id;
  } finally {
    await prisma.$disconnect();
  }
};
/** Deletes one seeded test notification (title 'NTF-%', E2E user only); returns the number of deleted rows so the caller can assert it. */
export const deleteNotification = async (id: string): Promise<number> => {
  const prisma = connect();
  try {
    return await prisma.$executeRawUnsafe(
      `DELETE FROM "Notification" WHERE id = $1 AND title LIKE 'NTF-%' AND "userId" IN (SELECT id FROM "User" WHERE email LIKE $2)`,
      id, NTF_USER,
    );
  } finally {
    await prisma.$disconnect();
  }
};

/** The API refuses to create an activity scheduled in the past, so tests that need an overdue one back-date it here after creating it. */
export const backdateActivity = async (activityId: string, dueDateIso: string): Promise<void> => {
  const prisma = connect();
  try {
    await prisma.$executeRawUnsafe('UPDATE "MfgActivity" SET "dueDate" = $1::timestamp WHERE id = $2', dueDateIso, activityId);
  } finally {
    await prisma.$disconnect();
  }
};
