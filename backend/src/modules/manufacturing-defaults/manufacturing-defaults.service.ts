import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  APPROVAL_RULE_DEFAULTS,
  BUSINESS_CALENDAR_DEFAULT,
  HOLIDAY_DEFAULTS,
  REPORT_DEFAULTS,
  SLA_POLICY_DEFAULTS,
  buildFieldPermissionDefaults,
  buildMasterValueDefaults,
  buildRolePermissionDefaults,
} from './manufacturing-defaults.data';

// Seeds every Administration default a new Manufacturing-workspace org needs on day one —
// RolePermission/FieldPermission (so record-access + field masking behave sanely before an
// admin ever visits Administration), ApprovalRule, MasterValue, BusinessCalendar/Holiday, and
// the 22 SlaPolicy rows — all copied verbatim from design_handoff_manufacturing_workspace's
// mfg-schema.js (see manufacturing-defaults.data.ts for the source-of-truth mapping).
//
// Idempotent: guarded by a RolePermission-existence check per org, so calling this twice for
// the same org (e.g. a retried registration) never duplicates rows.
@Injectable()
export class ManufacturingDefaultsService {
  private readonly logger = new Logger(ManufacturingDefaultsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async seedForOrg(orgId: string): Promise<void> {
    const alreadySeeded = await this.prisma.rolePermission.findFirst({ where: { orgId } });
    if (alreadySeeded) return;

    await this.prisma.rolePermission.createMany({
      data: buildRolePermissionDefaults().map((d) => ({ ...d, orgId })),
    });

    await this.prisma.fieldPermission.createMany({
      data: buildFieldPermissionDefaults().map((d) => ({ ...d, orgId })),
    });

    await this.prisma.approvalRule.createMany({
      data: APPROVAL_RULE_DEFAULTS.map((r) => ({ ...r, orgId })),
    });

    await this.prisma.masterValue.createMany({
      data: buildMasterValueDefaults().map((m) => ({ ...m, orgId })),
    });

    const calendar = await this.prisma.businessCalendar.create({
      data: {
        orgId,
        timezone: BUSINESS_CALENDAR_DEFAULT.timezone,
        days: BUSINESS_CALENDAR_DEFAULT.days as Prisma.InputJsonValue,
      },
    });
    void calendar;

    await this.prisma.holiday.createMany({
      data: HOLIDAY_DEFAULTS.map((h) => ({ orgId, name: h.name, date: new Date(h.date) })),
    });

    await this.prisma.slaPolicy.createMany({
      data: SLA_POLICY_DEFAULTS.map((p) => ({
        orgId,
        moduleKey: p.moduleKey,
        name: p.name,
        startEvent: p.startEvent,
        stopEvent: p.stopEvent,
        calendarType: p.calendarType,
        targets: p.targets as unknown as Prisma.InputJsonValue,
        escalationLevels: p.escalationLevels as unknown as Prisma.InputJsonValue,
        pauseStatuses: p.pauseStatuses,
        isActive: true,
      })),
    });

    await this.prisma.report.createMany({
      data: REPORT_DEFAULTS.map((r) => ({ ...r, orgId })),
    });
  }

  // Called from registration paths — never lets a seeding failure block signup. A failed seed
  // leaves RolePermission empty for the org, which resolveOwnerScope treats as "default to OWN"
  // (the safe, restrictive default), not an outage.
  async seedForOrgSafely(orgId: string): Promise<void> {
    try {
      await this.seedForOrg(orgId);
    } catch (err) {
      this.logger.error(`Failed to seed Manufacturing defaults for org '${orgId}'`, err instanceof Error ? err.stack : err);
    }
  }
}
