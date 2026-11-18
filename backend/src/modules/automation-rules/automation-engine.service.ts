import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ROLE_LABEL_TO_ENUM } from '../manufacturing-defaults/manufacturing-defaults.data';

// The events a rule can start from. Rules are saved with one of these exact names as their trigger.
export const AUTOMATION_TRIGGERS = ['Lead created', 'Quotation sent', 'Opportunity lost', 'PO accepted', 'Payment overdue', 'Service ticket created'] as const;
export type AutomationTrigger = (typeof AUTOMATION_TRIGGERS)[number];

// What a rule can do: "Notify owner", "Notify role: Sales Manager" or "Create task: <subject>".
export const AUTOMATION_ACTION_PATTERN = /^(Notify owner|Notify role: .+|Create task: .+)$/;

export interface AutomationEvent {
  // Where the record lives in the app, for the notification link ("/quotations/…").
  readonly link: string;
  readonly title: string;
  readonly ownerId?: string | null;
  readonly accountId?: string | null;
  readonly opportunityId?: string | null;
  readonly value?: number | null;
}

// "Value >= 100000" (or ≥) restricts a rule to bigger records; empty or "Always" means every time.
export const conditionMet = (condition: string, value: number | null | undefined): boolean => {
  const text = condition.trim();
  if (!text || /^always$/i.test(text)) return true;
  const match = text.match(/^value\s*(>=|≥|>|<=|≤|<)\s*([\d,.]+)$/i);
  if (!match) return false;
  const limit = Number(match[2].replace(/,/g, ''));
  const actual = value ?? 0;
  switch (match[1]) {
    case '>=':
    case '≥':
      return actual >= limit;
    case '>':
      return actual > limit;
    case '<=':
    case '≤':
      return actual <= limit;
    default:
      return actual < limit;
  }
};

@Injectable()
export class AutomationEngineService {
  readonly #logger = new Logger(AutomationEngineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // Runs every active rule of the org for this trigger and records each run. Never throws: automation is a
  // side effect and must not break the action (sending a quotation, accepting a PO) that raised the event.
  async fire(orgId: string, trigger: AutomationTrigger, event: AutomationEvent): Promise<void> {
    try {
      const rules = await this.prisma.automationRule.findMany({ where: { orgId, isActive: true, isDeleted: false, trigger: { equals: trigger, mode: 'insensitive' } } });
      for (const rule of rules) {
        if (!conditionMet(rule.condition, event.value)) continue;
        let status = 'OK';
        let details = `${rule.action} · ${event.title}`;
        try {
          await this.perform(orgId, rule.action, event);
        } catch (err) {
          status = 'Failed';
          details = err instanceof Error ? err.message : 'The action could not be completed.';
          this.#logger.error(`Automation rule ${rule.id} failed`, err instanceof Error ? err.stack : err);
        }
        await this.prisma.automationRun.create({ data: { automationRuleId: rule.id, status, details } });
        await this.prisma.automationRule.update({ where: { id: rule.id }, data: { lastRunStatus: status, lastRunAt: new Date() } });
      }
    } catch (err) {
      this.#logger.error(`Automation for '${trigger}' failed`, err instanceof Error ? err.stack : err);
    }
  }

  private async perform(orgId: string, action: string, event: AutomationEvent): Promise<void> {
    const message = `Automation: ${event.title}`;
    if (action === 'Notify owner') {
      if (!event.ownerId) throw new Error('The record has no owner to notify.');
      await this.notifications.create(orgId, event.ownerId, message, event.title, event.link);
      return;
    }
    const role = action.match(/^Notify role: (.+)$/)?.[1].trim();
    if (role) {
      const mfgRole = ROLE_LABEL_TO_ENUM[role];
      if (!mfgRole) throw new Error(`Unknown role '${role}'.`);
      const users = await this.prisma.user.findMany({ where: { orgId, isActive: true, mfgRole }, select: { id: true } });
      await Promise.all(users.map((user) => this.notifications.create(orgId, user.id, message, event.title, event.link)));
      return;
    }
    const subject = action.match(/^Create task: (.+)$/)?.[1].trim();
    if (subject) {
      await this.prisma.mfgActivity.create({
        data: {
          orgId,
          type: 'Call',
          subject,
          notes: event.title,
          ownerId: event.ownerId,
          accountId: event.accountId,
          opportunityId: event.opportunityId,
          priority: 'Medium',
          status: 'Open',
          dueDate: new Date(),
        },
      });
      return;
    }
    throw new Error(`Unknown action '${action}'.`);
  }
}
