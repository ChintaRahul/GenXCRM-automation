import { Test } from '@nestjs/testing';
import { AutomationEngineService, conditionMet } from './automation-engine.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

describe('conditionMet', () => {
  it.each([
    ['', 100, true],
    ['Always', undefined, true],
    ['Value >= 100000', 100000, true],
    ['Value ≥ 1,00,000', 99999, false],
    ['value > 50', 51, true],
    ['Value < 10', 10, false],
    ['Value <= 10', 10, true],
    ['something odd', 10, false],
  ])('%j with value %j is %s', (condition, value, expected) => {
    expect(conditionMet(condition, value)).toBe(expected);
  });
});

describe('AutomationEngineService', () => {
  let service: AutomationEngineService;
  let prisma: any;
  const notifications = { create: jest.fn().mockResolvedValue(undefined) };
  const event = { link: '/quotations/q-1', title: 'Quotation v1 sent', ownerId: 'u1', accountId: 'a-1', opportunityId: 'op-1', value: 200000 };
  const rule = (overrides: object) => ({ id: 'r-1', trigger: 'Quotation sent', condition: 'Always', action: 'Notify owner', ...overrides });

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma = {
      automationRule: { findMany: jest.fn(), update: jest.fn() },
      automationRun: { create: jest.fn() },
      user: { findMany: jest.fn().mockResolvedValue([{ id: 'm1' }, { id: 'm2' }]) },
      mfgActivity: { create: jest.fn() },
    };
    const module = await Test.createTestingModule({
      providers: [AutomationEngineService, { provide: PrismaService, useValue: prisma }, { provide: NotificationsService, useValue: notifications }],
    }).compile();
    service = module.get(AutomationEngineService);
  });

  it('looks up only the org\'s active rules for the trigger', async () => {
    prisma.automationRule.findMany.mockResolvedValue([]);
    await service.fire('org-1', 'Quotation sent', event);
    expect(prisma.automationRule.findMany).toHaveBeenCalledWith({ where: expect.objectContaining({ orgId: 'org-1', isActive: true, isDeleted: false }) });
  });

  it('notifies the owner, logs the run and stamps the rule', async () => {
    prisma.automationRule.findMany.mockResolvedValue([rule({})]);
    await service.fire('org-1', 'Quotation sent', event);
    expect(notifications.create).toHaveBeenCalledWith('org-1', 'u1', expect.any(String), 'Quotation v1 sent', '/quotations/q-1');
    expect(prisma.automationRun.create).toHaveBeenCalledWith({ data: expect.objectContaining({ automationRuleId: 'r-1', status: 'OK' }) });
    expect(prisma.automationRule.update).toHaveBeenCalledWith({ where: { id: 'r-1' }, data: expect.objectContaining({ lastRunStatus: 'OK' }) });
  });

  it('skips a rule whose condition is not met, without logging a run', async () => {
    prisma.automationRule.findMany.mockResolvedValue([rule({ condition: 'Value >= 500000' })]);
    await service.fire('org-1', 'Quotation sent', event);
    expect(notifications.create).not.toHaveBeenCalled();
    expect(prisma.automationRun.create).not.toHaveBeenCalled();
  });

  it('notifies everyone in a role', async () => {
    prisma.automationRule.findMany.mockResolvedValue([rule({ action: 'Notify role: Sales Manager' })]);
    await service.fire('org-1', 'Quotation sent', event);
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1', mfgRole: 'SALES_MANAGER' }) }));
    expect(notifications.create).toHaveBeenCalledTimes(2);
  });

  it('creates a task linked to the record', async () => {
    prisma.automationRule.findMany.mockResolvedValue([rule({ action: 'Create task: Call the customer' })]);
    await service.fire('org-1', 'Quotation sent', event);
    expect(prisma.mfgActivity.create).toHaveBeenCalledWith({ data: expect.objectContaining({ orgId: 'org-1', subject: 'Call the customer', ownerId: 'u1', opportunityId: 'op-1', accountId: 'a-1' }) });
  });

  it('records a failure with its reason instead of throwing', async () => {
    prisma.automationRule.findMany.mockResolvedValue([rule({ action: 'Notify role: Wizard' })]);
    await expect(service.fire('org-1', 'Quotation sent', event)).resolves.toBeUndefined();
    expect(prisma.automationRun.create).toHaveBeenCalledWith({ data: expect.objectContaining({ status: 'Failed', details: "Unknown role 'Wizard'." }) });
    expect(prisma.automationRule.update).toHaveBeenCalledWith({ where: { id: 'r-1' }, data: expect.objectContaining({ lastRunStatus: 'Failed' }) });
  });

  it('never throws into the caller when the lookup itself fails', async () => {
    prisma.automationRule.findMany.mockRejectedValue(new Error('db down'));
    await expect(service.fire('org-1', 'Quotation sent', event)).resolves.toBeUndefined();
  });
});
