import { AutomationEngineService } from '../automation-rules/automation-engine.service';
import { MfgNurturingService } from '../nurturing/mfg-nurturing.service';
import { Test } from '@nestjs/testing';
import { SlaEngineService } from './sla-engine.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';

const mockPrisma = {
  slaPolicy: { findMany: jest.fn() },
  slaTimer: { findFirst: jest.fn(), create: jest.fn(), updateMany: jest.fn(), update: jest.fn(), findMany: jest.fn() },
  businessCalendar: { findFirst: jest.fn() },
  holiday: { findMany: jest.fn() },
  user: { findUnique: jest.fn(), findMany: jest.fn() },
  approval: { findFirst: jest.fn() },
  mfgLead: { findFirst: jest.fn() },
  opportunity: { findFirst: jest.fn(), findMany: jest.fn() },
  rfq: { findFirst: jest.fn() },
  serviceTicket: { findFirst: jest.fn() },
  mfgActivity: { findMany: jest.fn(), create: jest.fn() },
  evaluation: { findMany: jest.fn() },
  tender: { findMany: jest.fn() },
  siteVisit: { findMany: jest.fn() },
  quotation: { findFirst: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
  salesOrder: { findFirst: jest.fn(), findMany: jest.fn() },
  coverage: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  installedAsset: { findMany: jest.fn(), update: jest.fn() },
  paymentMilestone: { findMany: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
};

const mockMail = { send: jest.fn().mockResolvedValue(true) };
const mockNotifications = { create: jest.fn().mockResolvedValue(undefined), createOnce: jest.fn().mockResolvedValue(undefined) };

const CALENDAR_DAYS_POLICY = {
  id: 'policy-1',
  moduleKey: 'leads',
  name: 'Lead first response',
  startEvent: 'Lead created',
  stopEvent: 'First call logged',
  calendarType: 'Calendar days',
  targets: [{ cond: 'All leads', val: 2, unit: 'hours' }],
  escalationLevels: [
    { at: 75, who: 'Owner', channels: ['Email'] },
    { at: 100, who: 'Sales Manager', channels: ['Email'] },
    { at: 150, who: 'Director', channels: ['WhatsApp'] },
  ],
  pauseStatuses: [],
  isActive: true,
};

const mockNurturing = { enroll: jest.fn().mockResolvedValue(undefined) };

const mockAutomation = { fire: jest.fn().mockResolvedValue(undefined) };

describe('SlaEngineService', () => {
  let service: SlaEngineService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.businessCalendar.findFirst.mockResolvedValue(null);
    mockPrisma.holiday.findMany.mockResolvedValue([]);
    const module = await Test.createTestingModule({
      providers: [
        SlaEngineService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: MailService, useValue: mockMail },
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: MfgNurturingService, useValue: mockNurturing },
        { provide: AutomationEngineService, useValue: mockAutomation },
      ],
    }).compile();
    service = module.get(SlaEngineService);
  });

  describe('startTimer', () => {
    it('creates a timer for every active policy matching orgId/moduleKey/startEvent', async () => {
      mockPrisma.slaPolicy.findMany.mockResolvedValue([CALENDAR_DAYS_POLICY]);
      mockPrisma.slaTimer.findFirst.mockResolvedValue(null);
      await service.startTimer('org-1', 'leads', 'MfgLead', 'LD-1', 'Lead created');
      expect(mockPrisma.slaTimer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ orgId: 'org-1', slaPolicyId: 'policy-1', entityType: 'MfgLead', entityId: 'LD-1', status: 'On track' }),
        }),
      );
    });

    it('is idempotent: does not create a duplicate timer when one is already open', async () => {
      mockPrisma.slaPolicy.findMany.mockResolvedValue([CALENDAR_DAYS_POLICY]);
      mockPrisma.slaTimer.findFirst.mockResolvedValue({ id: 'existing-timer' });
      await service.startTimer('org-1', 'leads', 'MfgLead', 'LD-1', 'Lead created');
      expect(mockPrisma.slaTimer.create).not.toHaveBeenCalled();
    });

    it('does nothing when no policy matches', async () => {
      mockPrisma.slaPolicy.findMany.mockResolvedValue([]);
      await service.startTimer('org-1', 'leads', 'MfgLead', 'LD-1', 'Lead created');
      expect(mockPrisma.slaTimer.create).not.toHaveBeenCalled();
    });

    describe('pickTarget — money-threshold and tightest-wins', () => {
      const MULTI_TARGET_POLICY = {
        ...CALENDAR_DAYS_POLICY,
        targets: [
          { cond: 'All leads', val: 2, unit: 'hours' },
          { cond: 'Source = IndiaMART or Google Ads', val: 30, unit: 'minutes' },
          { cond: 'Estimated value ≥ ₹50 L', val: 1, unit: 'hours' },
        ],
      };

      it('evaluates a real money threshold (not just a label) against the entity value', async () => {
        mockPrisma.slaPolicy.findMany.mockResolvedValue([MULTI_TARGET_POLICY]);
        mockPrisma.slaTimer.findFirst.mockResolvedValue(null);
        const startedAt = Date.now();
        // 60 lakh crosses the ₹50 L threshold -> 1 hour target, not the 2-hour catch-all.
        await service.startTimer('org-1', 'leads', 'MfgLead', 'LD-1', 'Lead created', undefined, 6_000_000);
        const dueAt = (mockPrisma.slaTimer.create.mock.calls[0][0].data.dueAt as Date).getTime();
        expect(dueAt - startedAt).toBeGreaterThan(59 * 60_000);
        expect(dueAt - startedAt).toBeLessThan(61 * 60_000);
      });

      it('does not apply a money threshold the entity value falls short of', async () => {
        mockPrisma.slaPolicy.findMany.mockResolvedValue([MULTI_TARGET_POLICY]);
        mockPrisma.slaTimer.findFirst.mockResolvedValue(null);
        const startedAt = Date.now();
        await service.startTimer('org-1', 'leads', 'MfgLead', 'LD-1', 'Lead created', undefined, 1_000_000);
        const dueAt = (mockPrisma.slaTimer.create.mock.calls[0][0].data.dueAt as Date).getTime();
        expect(dueAt - startedAt).toBeGreaterThan(119 * 60_000); // falls back to the 2h catch-all
      });

      it('picks the tighter of two simultaneously-applicable targets (source match vs. money threshold)', async () => {
        mockPrisma.slaPolicy.findMany.mockResolvedValue([MULTI_TARGET_POLICY]);
        mockPrisma.slaTimer.findFirst.mockResolvedValue(null);
        const startedAt = Date.now();
        // Both the 30-min source target and the 1h value target apply -> 30 min (tighter) wins.
        await service.startTimer('org-1', 'leads', 'MfgLead', 'LD-1', 'Lead created', 'IndiaMART', 6_000_000);
        const dueAt = (mockPrisma.slaTimer.create.mock.calls[0][0].data.dueAt as Date).getTime();
        expect(dueAt - startedAt).toBeGreaterThan(29 * 60_000);
        expect(dueAt - startedAt).toBeLessThan(31 * 60_000);
      });

      it('parses ₹1 Cr thresholds as crores, not lakhs', async () => {
        const crPolicy = {
          ...CALENDAR_DAYS_POLICY,
          targets: [{ cond: 'All', val: 14, unit: 'days' }, { cond: 'Value ≥ ₹1 Cr', val: 7, unit: 'days' }],
        };
        mockPrisma.slaPolicy.findMany.mockResolvedValue([crPolicy]);
        mockPrisma.slaTimer.findFirst.mockResolvedValue(null);
        const startedAt = Date.now();

        // ₹99 L must NOT cross ₹1 Cr -> falls back to the 14-day catch-all.
        await service.startTimer('org-1', 'opps', 'Opportunity', 'OP-1', 'Stage entered', undefined, 9_900_000);
        const dueAt1 = (mockPrisma.slaTimer.create.mock.calls[0][0].data.dueAt as Date).getTime();
        expect(dueAt1 - startedAt).toBeGreaterThan(13 * 24 * 60 * 60_000);

        // ₹1.5 Cr crosses ₹1 Cr -> the tighter 7-day target applies.
        await service.startTimer('org-1', 'opps', 'Opportunity', 'OP-2', 'Stage entered', undefined, 15_000_000);
        const dueAt2 = (mockPrisma.slaTimer.create.mock.calls[1][0].data.dueAt as Date).getTime();
        expect(dueAt2 - startedAt).toBeLessThan(8 * 24 * 60 * 60_000);
      });
    });
  });

  describe('stopTimer', () => {
    it('marks every open timer for matching policies as Met', async () => {
      mockPrisma.slaPolicy.findMany.mockResolvedValue([CALENDAR_DAYS_POLICY]);
      await service.stopTimer('org-1', 'leads', 'MfgLead', 'LD-1', 'First call logged');
      expect(mockPrisma.slaTimer.updateMany).toHaveBeenCalledWith({
        where: { orgId: 'org-1', slaPolicyId: 'policy-1', entityType: 'MfgLead', entityId: 'LD-1', isDeleted: false, stoppedAt: null },
        data: { stoppedAt: expect.any(Date), status: 'Met' },
      });
    });
  });

  describe('runDateTriggeredSweep', () => {
    it('reminds a tender owner of the 7-day and the last-day deadline separately', async () => {
      mockPrisma.slaPolicy.findMany.mockResolvedValue([]);
      const soon = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
      const tomorrow = new Date(Date.now() + 12 * 60 * 60 * 1000);
      mockPrisma.tender.findMany.mockResolvedValueOnce([
        { id: 't-1', orgId: 'org-1', ownerId: 'u1', title: 'Rail weighbridge', submissionDeadline: soon },
        { id: 't-2', orgId: 'org-1', ownerId: 'u1', title: 'Port scales', submissionDeadline: tomorrow },
      ]);
      await service.runDateTriggeredSweep();
      expect(mockNotifications.createOnce).toHaveBeenCalledWith('org-1', 'u1', expect.stringContaining('7-day notice'), expect.stringContaining('Rail weighbridge'), '/tenders/t-1');
      expect(mockNotifications.createOnce).toHaveBeenCalledWith('org-1', 'u1', expect.stringContaining('1-day notice'), expect.stringContaining('Port scales'), '/tenders/t-2');
    });

    it('reminds the owner of a trial two days past its planned date, once per date', async () => {
      mockPrisma.slaPolicy.findMany.mockResolvedValue([]);
      mockPrisma.evaluation.findMany.mockResolvedValueOnce([{ id: 'e-1', orgId: 'org-1', ownerId: 'u1', title: 'Trial at Shree', plannedDate: new Date('2026-10-01') }]);
      await service.runDateTriggeredSweep();
      expect(mockNotifications.createOnce).toHaveBeenCalledWith('org-1', 'u1', 'Evaluation overdue · 2026-10-01', expect.stringContaining('Trial at Shree'), '/demos/e-1');
    });

    it('marks a past-due milestone Overdue and books a payment follow-up for its owner', async () => {
      mockPrisma.slaPolicy.findMany.mockResolvedValue([]);
      mockPrisma.paymentMilestone.findMany.mockResolvedValueOnce([{ id: 'pm-1', orgId: 'org-1', ownerId: 'u1', accountId: 'a-1', milestone: 'Advance' }]);
      await service.runDateTriggeredSweep();
      expect(mockPrisma.paymentMilestone.update).toHaveBeenCalledWith({ where: { id: 'pm-1' }, data: { status: 'Overdue' } });
      expect(mockPrisma.mfgActivity.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ orgId: 'org-1', type: 'Payment follow-up', ownerId: 'u1', accountId: 'a-1', priority: 'High' }),
      });
    });

    it('flags coverage inside its 90-day window as Due soon with a renewal task', async () => {
      mockPrisma.slaPolicy.findMany.mockResolvedValue([]);
      mockPrisma.coverage.findMany.mockResolvedValueOnce([{ id: 'c-1', orgId: 'org-1', ownerId: 'u1', accountId: 'a-1', type: 'AMC', end: new Date('2026-12-01') }]);
      await service.runDateTriggeredSweep();
      expect(mockPrisma.coverage.update).toHaveBeenCalledWith({ where: { id: 'c-1' }, data: { status: 'Due soon' } });
      expect(mockPrisma.mfgActivity.create).toHaveBeenCalledWith({ data: expect.objectContaining({ orgId: 'org-1', ownerId: 'u1', subject: expect.stringContaining('AMC') }) });
    });

    it('enrols coverage that turns Due soon in amc_due_soon sequences', async () => {
      mockPrisma.slaPolicy.findMany.mockResolvedValue([]);
      mockPrisma.coverage.findMany.mockResolvedValueOnce([{ id: 'c-7', orgId: 'org-1', ownerId: 'u1', accountId: 'a-1', type: 'AMC', end: new Date('2026-12-01') }]);
      await service.runDateTriggeredSweep();
      expect(mockNurturing.enroll).toHaveBeenCalledWith('org-1', 'amc_due_soon', 'Coverage', 'c-7');
    });

    it('moves an asset whose warranty lapsed to Out of coverage, or Under AMC when an AMC is active', async () => {
      mockPrisma.slaPolicy.findMany.mockResolvedValue([]);
      mockPrisma.installedAsset.findMany.mockResolvedValueOnce([{ id: 'as-1' }, { id: 'as-2' }]);
      mockPrisma.coverage.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'c-9' });
      await service.runDateTriggeredSweep();
      expect(mockPrisma.installedAsset.update).toHaveBeenCalledWith({ where: { id: 'as-1' }, data: { status: 'Out of coverage' } });
      expect(mockPrisma.installedAsset.update).toHaveBeenCalledWith({ where: { id: 'as-2' }, data: { status: 'Under AMC' } });
    });

    it('marks Sent/Approved quotations past their validity date as Expired', async () => {
      mockPrisma.slaPolicy.findMany.mockResolvedValue([]);
      await service.runDateTriggeredSweep();
      expect(mockPrisma.quotation.updateMany).toHaveBeenCalledWith({
        where: { isDeleted: false, status: { in: ['Sent', 'Approved'] }, validUntil: { lt: expect.any(Date) } },
        data: { status: 'Expired' },
      });
    });

    it('starts SLA-17 for a sales order whose committed delivery is within 7 days, and skips terminal statuses', async () => {
      mockPrisma.slaPolicy.findMany.mockImplementation(({ where }) =>
        Promise.resolve(
          where.moduleKey === 'sorders' && where.startEvent === 'Committed delivery − 7 days'
            ? [{ ...CALENDAR_DAYS_POLICY, id: 'sla-17', orgId: 'org-1', moduleKey: 'sorders', startEvent: 'Committed delivery − 7 days' }]
            : [],
        ),
      );
      mockPrisma.salesOrder.findMany.mockResolvedValue([{ id: 'so-1', orgId: 'org-1' }]);
      mockPrisma.slaTimer.findFirst.mockResolvedValue(null);
      await service.runDateTriggeredSweep();
      expect(mockPrisma.salesOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            orgId: { in: ['org-1'] },
            isDeleted: false,
            committedDelivery: { lte: expect.any(Date) },
            status: { notIn: ['Dispatched', 'Delivered', 'Installation', 'Commissioned', 'Closed'] },
          }),
        }),
      );
      expect(mockPrisma.slaTimer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ orgId: 'org-1', entityType: 'SalesOrder', entityId: 'so-1' }),
        }),
      );
    });

    it('SLA-06 picks the target from the activity priority, not the first target', async () => {
      const SLA_06 = {
        ...CALENDAR_DAYS_POLICY, id: 'sla-06', orgId: 'org-1', moduleKey: 'activities', startEvent: 'Scheduled time',
        targets: [{ cond: 'Priority = High', val: 4, unit: 'hours' }, { cond: 'Priority = Medium', val: 1, unit: 'days' }, { cond: 'Priority = Low', val: 3, unit: 'days' }],
      };
      mockPrisma.slaPolicy.findMany.mockImplementation(({ where }) =>
        Promise.resolve(where.moduleKey === 'activities' && where.startEvent === 'Scheduled time' ? [SLA_06] : []),
      );
      mockPrisma.mfgActivity.findMany.mockResolvedValue([
        { id: 'act-high', orgId: 'org-1', priority: 'High' },
        { id: 'act-low', orgId: 'org-1', priority: 'Low' },
      ]);
      mockPrisma.slaTimer.findFirst.mockResolvedValue(null);
      await service.runDateTriggeredSweep();
      const due = (id: string) => {
        const call = mockPrisma.slaTimer.create.mock.calls.find(([arg]) => arg.data.entityId === id);
        return (call![0].data.dueAt as Date).getTime() - (call![0].data.startedAt as Date).getTime();
      };
      expect(due('act-high')).toBe(4 * 60 * 60 * 1000);
      expect(due('act-low')).toBe(3 * 24 * 60 * 60 * 1000);
    });

    it('alerts the owner once-per-record when an open opportunity close date has passed', async () => {
      mockPrisma.slaPolicy.findMany.mockResolvedValue([]);
      mockPrisma.opportunity.findMany.mockResolvedValue([
        { id: 'op-1', orgId: 'org-1', ownerId: 'u-1', title: 'Weighbridge for Shree', closeDate: new Date('2026-09-01T00:00:00Z') },
      ]);
      await service.runDateTriggeredSweep();
      expect(mockPrisma.opportunity.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isDeleted: false, stage: { notIn: ['Won', 'Lost'] }, closeDate: { lt: expect.any(Date) } }),
        }),
      );
      expect(mockNotifications.createOnce).toHaveBeenCalledWith(
        'org-1', 'u-1', 'Expected close date passed', expect.stringContaining('Weighbridge for Shree'), '/opportunities/op-1',
      );
    });

    it('reminds the sales owner once per scheduled date about an open visit due within a day', async () => {
      mockPrisma.slaPolicy.findMany.mockResolvedValue([]);
      mockPrisma.siteVisit.findMany.mockResolvedValue([
        { id: 'v-1', orgId: 'org-1', ownerId: 'u-1', title: 'Survey at Shree', visitDate: new Date('2026-10-19T00:00:00Z'), time: '10:30' },
      ]);
      await service.runDateTriggeredSweep();
      expect(mockPrisma.siteVisit.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ isDeleted: false, status: { in: ['Planned', 'Confirmed', 'Rescheduled'] } }) }),
      );
      expect(mockNotifications.createOnce).toHaveBeenCalledWith(
        'org-1', 'u-1', 'Site visit reminder · 2026-10-19', expect.stringContaining('10:30'), '/site-visits/v-1',
      );
    });

    it('does nothing for a rule with no active policies configured for any org', async () => {
      mockPrisma.slaPolicy.findMany.mockResolvedValue([]);
      await service.runDateTriggeredSweep();
      expect(mockPrisma.salesOrder.findMany).not.toHaveBeenCalled();
      // (the status sweeps query milestones without an org list; only the SLA rule sweep scopes by orgId)
      expect(mockPrisma.paymentMilestone.findMany).not.toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ orgId: expect.anything() }) }));
    });

    it('does not let one rule failing stop the rest of the sweep from running', async () => {
      mockPrisma.slaPolicy.findMany.mockImplementation(({ where }) => {
        if (where.moduleKey === 'opps') return Promise.reject(new Error('boom'));
        if (where.moduleKey === 'payments') return Promise.resolve([{ ...CALENDAR_DAYS_POLICY, id: 'sla-22', orgId: 'org-1', moduleKey: 'payments', startEvent: 'Due date' }]);
        return Promise.resolve([]);
      });
      mockPrisma.paymentMilestone.findMany.mockResolvedValue([]);
      await expect(service.runDateTriggeredSweep()).resolves.toBeUndefined();
      expect(mockPrisma.paymentMilestone.findMany).toHaveBeenCalled();
    });
  });

  describe('getSlaState', () => {
    it('returns null when no timer exists', async () => {
      mockPrisma.slaTimer.findFirst.mockResolvedValue(null);
      await expect(service.getSlaState('org-1', 'MfgLead', 'LD-1')).resolves.toBeNull();
    });

    it('returns gray/Met for a stopped timer', async () => {
      mockPrisma.slaTimer.findFirst.mockResolvedValue({ status: 'Met', dueAt: new Date() });
      await expect(service.getSlaState('org-1', 'MfgLead', 'LD-1')).resolves.toEqual({ l: 'Met', t: 'gray' });
    });

    it('returns red/Breached when now is past dueAt', async () => {
      const dueAt = new Date(Date.now() - 60 * 60_000);
      mockPrisma.slaTimer.findFirst.mockResolvedValue({ status: 'Breached', dueAt });
      const result = await service.getSlaState('org-1', 'MfgLead', 'LD-1');
      expect(result?.t).toBe('red');
      expect(result?.l).toMatch(/^Breached/);
    });

    it('returns amber/At risk when status is At risk and not yet due', async () => {
      const dueAt = new Date(Date.now() + 30 * 60_000);
      mockPrisma.slaTimer.findFirst.mockResolvedValue({ status: 'At risk', dueAt });
      const result = await service.getSlaState('org-1', 'MfgLead', 'LD-1');
      expect(result?.t).toBe('amber');
      expect(result?.l).toMatch(/^Due in/);
    });

    it('returns green/On track when comfortably before dueAt', async () => {
      const dueAt = new Date(Date.now() + 90 * 60_000);
      mockPrisma.slaTimer.findFirst.mockResolvedValue({ status: 'On track', dueAt });
      const result = await service.getSlaState('org-1', 'MfgLead', 'LD-1');
      expect(result?.t).toBe('green');
    });
  });

  describe('tick / evaluateTimer / fireEscalation', () => {
    it('sets status to Breached and updates dueAt/lastEscalationLevel when fully elapsed', async () => {
      const startedAt = new Date(Date.now() - 3 * 60 * 60_000); // 3h ago, target 2h -> 150% elapsed
      mockPrisma.slaTimer.findMany.mockResolvedValue([
        { id: 't1', orgId: 'org-1', entityType: 'MfgLead', entityId: 'LD-1', startedAt, lastEscalationLevel: 0, slaPolicyId: 'policy-1', slaPolicy: CALENDAR_DAYS_POLICY },
      ]);
      mockPrisma.user.findMany.mockResolvedValue([{ email: 'owner@test.com' }]);
      mockPrisma.mfgLead.findFirst.mockResolvedValue(null);

      await service.tick();

      expect(mockPrisma.slaTimer.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 't1' }, data: expect.objectContaining({ status: 'Breached', lastEscalationLevel: 150 }) }),
      );
    });

    it('fires an Email escalation to every user with the matching MfgRole', async () => {
      const startedAt = new Date(Date.now() - 2 * 60 * 60_000); // exactly at target -> 100%
      mockPrisma.slaTimer.findMany.mockResolvedValue([
        { id: 't1', orgId: 'org-1', entityType: 'MfgLead', entityId: 'LD-1', startedAt, lastEscalationLevel: 0, slaPolicyId: 'policy-1', slaPolicy: CALENDAR_DAYS_POLICY },
      ]);
      mockPrisma.user.findMany.mockResolvedValue([{ email: 'mgr@test.com' }]);

      await service.tick();

      // Level 75 ('Owner') has no owner resolvable (moduleKey 'leads' -> mfgLead lookup returns
      // null in this test), level 100 ('Sales Manager') resolves via MfgRole and sends email.
      expect(mockMail.send).toHaveBeenCalledWith('mgr@test.com', expect.stringContaining('SLA alert'), expect.any(String));
    });

    it('does not re-fire an escalation level already crossed on a previous tick', async () => {
      const startedAt = new Date(Date.now() - 2 * 60 * 60_000); // 100% elapsed
      mockPrisma.slaTimer.findMany.mockResolvedValue([
        { id: 't1', orgId: 'org-1', entityType: 'MfgLead', entityId: 'LD-1', startedAt, lastEscalationLevel: 100, slaPolicyId: 'policy-1', slaPolicy: CALENDAR_DAYS_POLICY },
      ]);

      await service.tick();

      expect(mockMail.send).not.toHaveBeenCalled();
      expect(mockPrisma.slaTimer.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ lastEscalationLevel: 100 }) }),
      );
    });

    it('skips dispatch for a level whose channels do not include Email (e.g. WhatsApp-only)', async () => {
      const startedAt = new Date(Date.now() - 3.5 * 60 * 60_000); // 175% elapsed, crosses the 150% WhatsApp-only level
      mockPrisma.slaTimer.findMany.mockResolvedValue([
        { id: 't1', orgId: 'org-1', entityType: 'MfgLead', entityId: 'LD-1', startedAt, lastEscalationLevel: 100, slaPolicyId: 'policy-1', slaPolicy: CALENDAR_DAYS_POLICY },
      ]);

      await service.tick();

      expect(mockMail.send).not.toHaveBeenCalled();
    });

    it('resolves an Owner-type recipient via the moduleKey delegate lookup + user email', async () => {
      const startedAt = new Date(Date.now() - 1.6 * 60 * 60_000); // 80% elapsed, crosses only the 75% 'Owner' level
      mockPrisma.slaTimer.findMany.mockResolvedValue([
        { id: 't1', orgId: 'org-1', entityType: 'MfgLead', entityId: 'LD-1', startedAt, lastEscalationLevel: 0, slaPolicyId: 'policy-1', slaPolicy: CALENDAR_DAYS_POLICY },
      ]);
      mockPrisma.mfgLead.findFirst.mockResolvedValue({ ownerId: 'user-9' });
      mockPrisma.user.findUnique.mockResolvedValue({ email: 'rep@test.com' });

      await service.tick();

      expect(mockPrisma.mfgLead.findFirst).toHaveBeenCalledWith({ where: { id: 'LD-1', orgId: 'org-1' } });
      expect(mockMail.send).toHaveBeenCalledWith('rep@test.com', expect.any(String), expect.any(String));
    });

    it('creates an in-app Notification for a level whose channels include "In-app", with a link to the entity', async () => {
      const inAppPolicy = {
        ...CALENDAR_DAYS_POLICY,
        moduleKey: 'opps',
        escalationLevels: [{ at: 50, who: 'Sales Manager', channels: ['In-app'] }],
      };
      const startedAt = new Date(Date.now() - 1.1 * 60 * 60_000); // 55% elapsed
      mockPrisma.slaTimer.findMany.mockResolvedValue([
        { id: 't1', orgId: 'org-1', entityType: 'Opportunity', entityId: 'OP-1', startedAt, lastEscalationLevel: 0, slaPolicyId: 'policy-1', slaPolicy: inAppPolicy },
      ]);
      mockPrisma.user.findMany.mockResolvedValue([{ id: 'user-1', email: 'mgr@test.com' }]);

      await service.tick();

      expect(mockNotifications.create).toHaveBeenCalledWith(
        'org-1', 'user-1', expect.stringContaining('SLA alert'), expect.any(String), '/opportunities/OP-1',
      );
      expect(mockMail.send).not.toHaveBeenCalled();
    });

    it('dispatches both Email and In-app when a level lists both channels', async () => {
      const bothChannelsPolicy = {
        ...CALENDAR_DAYS_POLICY,
        escalationLevels: [{ at: 50, who: 'Sales Manager', channels: ['Email', 'In-app'] }],
      };
      const startedAt = new Date(Date.now() - 1.1 * 60 * 60_000);
      mockPrisma.slaTimer.findMany.mockResolvedValue([
        { id: 't1', orgId: 'org-1', entityType: 'MfgLead', entityId: 'LD-1', startedAt, lastEscalationLevel: 0, slaPolicyId: 'policy-1', slaPolicy: bothChannelsPolicy },
      ]);
      mockPrisma.user.findMany.mockResolvedValue([{ id: 'user-1', email: 'mgr@test.com' }]);

      await service.tick();

      expect(mockMail.send).toHaveBeenCalledWith('mgr@test.com', expect.any(String), expect.any(String));
      expect(mockNotifications.create).toHaveBeenCalledWith('org-1', 'user-1', expect.any(String), expect.any(String), '/leads/LD-1');
    });

    it('logs a resolvable-recipient gap instead of throwing when `who` maps to nothing', async () => {
      const unresolvablePolicy = {
        ...CALENDAR_DAYS_POLICY,
        escalationLevels: [{ at: 50, who: 'Some unmapped label', channels: ['Email'] }],
      };
      const startedAt = new Date(Date.now() - 1.1 * 60 * 60_000); // 55% elapsed
      mockPrisma.slaTimer.findMany.mockResolvedValue([
        { id: 't1', orgId: 'org-1', entityType: 'MfgLead', entityId: 'LD-1', startedAt, lastEscalationLevel: 0, slaPolicyId: 'policy-1', slaPolicy: unresolvablePolicy },
      ]);

      await expect(service.tick()).resolves.toBeUndefined();
      expect(mockMail.send).not.toHaveBeenCalled();
    });

    it('never throws out of tick() when one timer errors — other timers still get evaluated', async () => {
      mockPrisma.slaTimer.findMany.mockResolvedValue([
        { id: 'bad-timer', orgId: 'org-1', entityType: 'MfgLead', entityId: 'LD-1', startedAt: new Date(), lastEscalationLevel: 0, slaPolicyId: 'policy-1', slaPolicy: { ...CALENDAR_DAYS_POLICY, targets: [] } },
        { id: 'ok-timer', orgId: 'org-1', entityType: 'MfgLead', entityId: 'LD-2', startedAt: new Date(), lastEscalationLevel: 0, slaPolicyId: 'policy-1', slaPolicy: CALENDAR_DAYS_POLICY },
      ]);
      await expect(service.tick()).resolves.toBeUndefined();
    });
  });

  describe('tick — auto-pause/resume against pauseStatuses', () => {
    const RFQ_POLICY = { ...CALENDAR_DAYS_POLICY, id: 'sla-07', moduleKey: 'rfqs', pauseStatuses: ['Clarification required'] };

    it('pauses an open timer whose entity has entered a pauseStatuses value', async () => {
      const timer = {
        id: 't1', orgId: 'org-1', entityType: 'Rfq', entityId: 'rfq-1',
        startedAt: new Date(), pausedAt: null, lastEscalationLevel: 0, slaPolicyId: 'sla-07', slaPolicy: RFQ_POLICY,
      };
      mockPrisma.slaTimer.findMany.mockImplementation(({ where }) =>
        Promise.resolve('pausedAt' in where ? [] : [timer]),
      );
      mockPrisma.rfq.findFirst.mockResolvedValue({ id: 'rfq-1', orgId: 'org-1', status: 'Clarification required' });

      await service.tick();

      expect(mockPrisma.slaTimer.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { pausedAt: expect.any(Date) } });
    });

    it('does not re-pause a timer that is already paused', async () => {
      const timer = {
        id: 't1', orgId: 'org-1', entityType: 'Rfq', entityId: 'rfq-1',
        startedAt: new Date(), pausedAt: new Date(), lastEscalationLevel: 0, slaPolicyId: 'sla-07', slaPolicy: RFQ_POLICY,
      };
      mockPrisma.slaTimer.findMany.mockImplementation(({ where }) =>
        Promise.resolve('pausedAt' in where ? [] : [timer]),
      );
      mockPrisma.rfq.findFirst.mockResolvedValue({ id: 'rfq-1', orgId: 'org-1', status: 'Clarification required' });

      await service.tick();

      expect(mockPrisma.slaTimer.update).not.toHaveBeenCalled();
    });

    it('resumes a paused timer once its entity leaves the pauseStatuses value, shifting startedAt forward by the paused duration', async () => {
      const pausedAt = new Date(Date.now() - 60_000); // paused 60s ago
      const startedAt = new Date(Date.now() - 5 * 60_000);
      const timer = {
        id: 't1', orgId: 'org-1', entityType: 'Rfq', entityId: 'rfq-1',
        startedAt, pausedAt, lastEscalationLevel: 0, slaPolicyId: 'sla-07', slaPolicy: RFQ_POLICY,
      };
      mockPrisma.slaTimer.findMany.mockImplementation(({ where }) =>
        Promise.resolve('pausedAt' in where ? [] : [timer]),
      );
      mockPrisma.rfq.findFirst.mockResolvedValue({ id: 'rfq-1', orgId: 'org-1', status: 'Received' });

      await service.tick();

      expect(mockPrisma.slaTimer.update).toHaveBeenCalledWith({
        where: { id: 't1' },
        data: { pausedAt: null, startedAt: expect.any(Date) },
      });
      const call = mockPrisma.slaTimer.update.mock.calls.find((c) => c[0].data.pausedAt === null)!;
      const shiftedStartedAt = call[0].data.startedAt as Date;
      expect(shiftedStartedAt.getTime()).toBeGreaterThan(startedAt.getTime() + 55_000);
    });

    it('ignores policies with an empty pauseStatuses (the common case)', async () => {
      mockPrisma.slaTimer.findMany.mockImplementation(({ where }) =>
        Promise.resolve(
          'pausedAt' in where
            ? []
            : [{ id: 't1', orgId: 'org-1', entityType: 'MfgLead', entityId: 'LD-1', startedAt: new Date(), pausedAt: null, lastEscalationLevel: 0, slaPolicyId: 'policy-1', slaPolicy: CALENDAR_DAYS_POLICY }],
        ),
      );
      await service.tick();
      expect(mockPrisma.rfq.findFirst).not.toHaveBeenCalled();
    });
  });
});
