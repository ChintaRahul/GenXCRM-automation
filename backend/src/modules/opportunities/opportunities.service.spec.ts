import { AutomationEngineService } from '../automation-rules/automation-engine.service';
import { MfgNurturingService } from '../nurturing/mfg-nurturing.service';
import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException, NotImplementedException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { OpportunitiesService } from './opportunities.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SlaEngineService } from '../sla-timers/sla-engine.service';
import type { AuthUser } from '../../common/types/auth-user.type';

const mockPrisma = {
  opportunity: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn() },
  opportunityStageHistory: { create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn() },
  account: { findFirst: jest.fn() },
  mfgActivity: { create: jest.fn(), findMany: jest.fn() },
  siteVisit: { findMany: jest.fn() },
  evaluation: { findMany: jest.fn() },
  quotation: { findMany: jest.fn() },
  purchaseOrder: { findMany: jest.fn() },
  contact: { findFirst: jest.fn() },
  rolePermission: { findFirst: jest.fn() },
  user: { findMany: jest.fn() },
  $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
};

const mockSlaEngine = {
  startTimer: jest.fn().mockResolvedValue(undefined),
  stopTimer: jest.fn().mockResolvedValue(undefined),
  getSlaState: jest.fn().mockResolvedValue(null),
};

const repUser: AuthUser = { id: 'rep-1', name: 'Rep', email: 'rep@test.com', role: Role.SALES_REP, teamId: 'team-1', orgId: 'org-1' };
const managerUser: AuthUser = { id: 'mgr-1', name: 'Mgr', email: 'mgr@test.com', role: Role.MANAGER, teamId: 'team-1', orgId: 'org-1' };
const directorUser: AuthUser = { id: 'dir-1', name: 'Dir', email: 'dir@test.com', role: Role.DIRECTOR, teamId: null, orgId: 'org-1' };

const validCreateDto = {
  title: 'New weighbridge',
  accountId: 'A-1',
  product: 'Weighbridge',
  value: 100000,
  stage: 'Qualified',
  closeDate: '2026-10-01',
  nextAction: 'Call back',
  nextActionDate: '2026-10-05',
};

const mockNurturing = { enroll: jest.fn().mockResolvedValue(undefined) };

const mockAutomation = { fire: jest.fn().mockResolvedValue(undefined) };

describe('OpportunitiesService', () => {
  let service: OpportunitiesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        OpportunitiesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SlaEngineService, useValue: mockSlaEngine },
        { provide: AutomationEngineService, useValue: mockAutomation },
        { provide: MfgNurturingService, useValue: mockNurturing },
      ],
    }).compile();
    service = module.get(OpportunitiesService);
  });

  it('scopes findAll to ownerId for SALES_REP', async () => {
    mockPrisma.opportunity.count.mockResolvedValue(0);
    mockPrisma.opportunity.findMany.mockResolvedValue([]);
    await service.findAll({ page: 1, limit: 20 }, repUser);
    expect(mockPrisma.opportunity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1', ownerId: 'rep-1' }) }),
    );
  });

  it('scopes findAll to ownerId for an mfgRole with OWN record access', async () => {
    mockPrisma.rolePermission.findFirst.mockResolvedValue({ recordAccess: 'OWN' });
    mockPrisma.opportunity.count.mockResolvedValue(0);
    mockPrisma.opportunity.findMany.mockResolvedValue([]);
    await service.findAll({ page: 1, limit: 20 }, { ...directorUser, mfgRole: 'SALES_EXECUTIVE' });
    expect(mockPrisma.rolePermission.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orgId: 'org-1', role: 'SALES_EXECUTIVE', moduleKey: 'opps', isDeleted: false } }),
    );
    expect(mockPrisma.opportunity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ ownerId: 'dir-1' }) }),
    );
  });

  it('scopes findAll to the team for an mfgRole with TEAM record access', async () => {
    mockPrisma.rolePermission.findFirst.mockResolvedValue({ recordAccess: 'TEAM' });
    mockPrisma.user.findMany.mockResolvedValue([{ id: 'mgr-1' }, { id: 'rep-1' }]);
    mockPrisma.opportunity.count.mockResolvedValue(0);
    mockPrisma.opportunity.findMany.mockResolvedValue([]);
    await service.findAll({ page: 1, limit: 20 }, { ...managerUser, mfgRole: 'SALES_MANAGER' });
    expect(mockPrisma.opportunity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ ownerId: { in: ['mgr-1', 'rep-1'] } }) }),
    );
  });

  it('does not scope findAll for an mfgRole with ALL record access', async () => {
    mockPrisma.rolePermission.findFirst.mockResolvedValue({ recordAccess: 'ALL' });
    mockPrisma.opportunity.count.mockResolvedValue(0);
    mockPrisma.opportunity.findMany.mockResolvedValue([]);
    await service.findAll({ page: 1, limit: 20 }, { ...repUser, mfgRole: 'SALES_HEAD' });
    const where = mockPrisma.opportunity.findMany.mock.calls.at(-1)![0].where;
    expect(where.ownerId).toBeUndefined();
  });

  it('does not scope findAll to ownerId for MANAGER', async () => {
    mockPrisma.opportunity.count.mockResolvedValue(0);
    mockPrisma.opportunity.findMany.mockResolvedValue([]);
    await service.findAll({ page: 1, limit: 20 }, managerUser);
    const where = mockPrisma.opportunity.findMany.mock.calls[0][0].where;
    expect(where.ownerId).toBeUndefined();
    expect(where.orgId).toBe('org-1');
  });

  it('does not scope findAll to ownerId for DIRECTOR', async () => {
    mockPrisma.opportunity.count.mockResolvedValue(0);
    mockPrisma.opportunity.findMany.mockResolvedValue([]);
    await service.findAll({ page: 1, limit: 20 }, directorUser);
    const where = mockPrisma.opportunity.findMany.mock.calls[0][0].where;
    expect(where.ownerId).toBeUndefined();
  });

  it('SALES_REP passing ?owner=<other-rep> still only sees their own records', async () => {
    mockPrisma.opportunity.count.mockResolvedValue(0);
    mockPrisma.opportunity.findMany.mockResolvedValue([]);
    await service.findAll({ page: 1, limit: 20, ownerId: ['other-rep-id'] }, repUser);
    const where = mockPrisma.opportunity.findMany.mock.calls[0][0].where;
    expect(where.ownerId).toBe('rep-1');
  });

  it('create defaults ownerId to the caller for a SALES_REP when omitted', async () => {
    mockPrisma.account.findFirst.mockResolvedValue({ id: 'A-1', orgId: 'org-1' });
    mockPrisma.opportunity.create.mockResolvedValue({ id: 'OP-1' });
    await service.create(validCreateDto as never, repUser);
    expect(mockPrisma.opportunity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ ownerId: 'rep-1' }),
    });
  });

  it('create throws ForbiddenException when caller has no orgId', async () => {
    mockPrisma.account.findFirst.mockResolvedValue({ id: 'A-1', orgId: 'org-1' });
    const noOrgUser = { ...directorUser, orgId: null } as unknown as AuthUser;
    await expect(service.create(validCreateDto as never, noOrgUser)).rejects.toThrow(ForbiddenException);
  });

  it('create rejects an accountId belonging to a different org', async () => {
    mockPrisma.account.findFirst.mockResolvedValue(null);
    await expect(service.create(validCreateDto as never, directorUser)).rejects.toThrow(BadRequestException);
  });

  it('create rejects an inactive contact', async () => {
    mockPrisma.account.findFirst.mockResolvedValue({ id: 'A-1' });
    mockPrisma.contact.findFirst.mockResolvedValue({ id: 'C-1', name: 'Old Contact', status: 'Inactive' });
    await expect(service.create({ ...validCreateDto, contactId: 'C-1' } as never, directorUser)).rejects.toThrow(BadRequestException);
    expect(mockPrisma.opportunity.create).not.toHaveBeenCalled();
  });

  it('create rejects a contactId belonging to a different org', async () => {
    mockPrisma.account.findFirst.mockResolvedValue({ id: 'A-1', orgId: 'org-1' });
    mockPrisma.contact.findFirst.mockResolvedValue(null);
    await expect(
      service.create({ ...validCreateDto, contactId: 'C-evil' } as never, directorUser),
    ).rejects.toThrow(BadRequestException);
  });

  it('create converts date-only closeDate/nextActionDate strings into real Date instances', async () => {
    mockPrisma.account.findFirst.mockResolvedValue({ id: 'A-1', orgId: 'org-1' });
    mockPrisma.opportunity.create.mockResolvedValue({ id: 'OP-1' });
    await service.create(validCreateDto as never, directorUser);
    expect(mockPrisma.opportunity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ closeDate: expect.any(Date), nextActionDate: expect.any(Date) }),
    });
  });

  it('performAction "Mark won" writes a stage history row and updates stage', async () => {
    mockPrisma.opportunity.findFirst.mockResolvedValue({ id: 'OP-1', orgId: 'org-1', stage: 'PO received', createdAt: new Date() });
    mockPrisma.opportunityStageHistory.findFirst.mockResolvedValue(null);
    mockPrisma.opportunity.update.mockResolvedValue({ id: 'OP-1', stage: 'Won' });
    mockPrisma.opportunityStageHistory.create.mockResolvedValue({});
    await service.performAction('OP-1', 'Mark won', {}, directorUser);
    expect(mockPrisma.opportunity.update).toHaveBeenCalledWith({ where: { id: 'OP-1' }, data: { stage: 'Won' } });
    expect(mockPrisma.opportunityStageHistory.create).toHaveBeenCalledWith({
      data: { opportunityId: 'OP-1', fromStage: 'PO received', toStage: 'Won', changedById: 'dir-1' },
    });
  });

  it('performAction "Mark won" stops and restarts the stage-stagnation SLA timer for the new stage', async () => {
    mockPrisma.opportunity.findFirst.mockResolvedValue({ id: 'OP-1', orgId: 'org-1', stage: 'PO received', createdAt: new Date() });
    mockPrisma.opportunityStageHistory.findFirst.mockResolvedValue(null);
    mockPrisma.opportunity.update.mockResolvedValue({ id: 'OP-1', orgId: 'org-1', stage: 'Won', value: 500000 });
    mockPrisma.opportunityStageHistory.create.mockResolvedValue({});
    await service.performAction('OP-1', 'Mark won', {}, directorUser);
    expect(mockSlaEngine.stopTimer).toHaveBeenCalledWith('org-1', 'opps', 'Opportunity', 'OP-1', 'Stage changed');
    expect(mockSlaEngine.startTimer).toHaveBeenCalledWith('org-1', 'opps', 'Opportunity', 'OP-1', 'Stage entered', 'Won', 500000);
  });

  it('performAction "Mark won" rejects an opportunity already Lost', async () => {
    mockPrisma.opportunity.findFirst.mockResolvedValue({ id: 'OP-1', orgId: 'org-1', stage: 'Lost', createdAt: new Date() });
    mockPrisma.opportunityStageHistory.findFirst.mockResolvedValue(null);
    await expect(service.performAction('OP-1', 'Mark won', {}, directorUser)).rejects.toThrow(BadRequestException);
  });

  it('performAction "Mark lost" requires the lost reason', async () => {
    mockPrisma.opportunity.findFirst.mockResolvedValue({ id: 'OP-1', orgId: 'org-1', stage: 'Negotiation', createdAt: new Date() });
    mockPrisma.opportunityStageHistory.findFirst.mockResolvedValue(null);
    await expect(service.performAction('OP-1', 'Mark lost', {}, directorUser)).rejects.toThrow(BadRequestException);
  });

  it('performAction "Mark lost" sets lostReason and writes stage history', async () => {
    mockPrisma.opportunity.findFirst.mockResolvedValue({ id: 'OP-1', orgId: 'org-1', stage: 'Negotiation', createdAt: new Date() });
    mockPrisma.opportunityStageHistory.findFirst.mockResolvedValue(null);
    mockPrisma.opportunity.update.mockResolvedValue({});
    mockPrisma.opportunityStageHistory.create.mockResolvedValue({});
    await service.performAction('OP-1', 'Mark lost', { lost: 'Price' }, directorUser);
    expect(mockPrisma.opportunity.update).toHaveBeenCalledWith({
      where: { id: 'OP-1' },
      data: { stage: 'Lost', lostReason: 'Price' },
    });
  });

  it('performAction "Mark lost" stores the competitor details given with it', async () => {
    mockPrisma.opportunity.findFirst.mockResolvedValue({ id: 'OP-1', orgId: 'org-1', stage: 'Negotiation', createdAt: new Date() });
    mockPrisma.opportunityStageHistory.findFirst.mockResolvedValue(null);
    mockPrisma.opportunity.update.mockResolvedValue({});
    mockPrisma.opportunityStageHistory.create.mockResolvedValue({});
    await service.performAction('OP-1', 'Mark lost', { lost: 'Competitor', competitorProduct: 'WB-200', competitorPrice: '450000', decisionDate: '2026-11-01', lostFeedback: 'Cheaper' }, directorUser);
    expect(mockPrisma.opportunity.update).toHaveBeenCalledWith({
      where: { id: 'OP-1' },
      data: { stage: 'Lost', lostReason: 'Competitor', competitorProduct: 'WB-200', competitorPrice: 450000, decisionDate: new Date('2026-11-01'), lostFeedback: 'Cheaper' },
    });
  });

  it('performAction "Mark lost" rejects a negative competitor price', async () => {
    mockPrisma.opportunity.findFirst.mockResolvedValue({ id: 'OP-1', orgId: 'org-1', stage: 'Negotiation', createdAt: new Date() });
    mockPrisma.opportunityStageHistory.findFirst.mockResolvedValue(null);
    await expect(service.performAction('OP-1', 'Mark lost', { lost: 'Competitor', competitorPrice: '-5' }, directorUser)).rejects.toThrow(BadRequestException);
  });

  it('performAction "Mark lost" for a timing reason books a 90-day re-engagement call', async () => {
    mockPrisma.opportunity.findFirst.mockResolvedValue({ id: 'OP-1', orgId: 'org-1', stage: 'Negotiation', createdAt: new Date() });
    mockPrisma.opportunityStageHistory.findFirst.mockResolvedValue(null);
    mockPrisma.opportunity.update.mockResolvedValue({ id: 'OP-1', orgId: 'org-1', accountId: 'a-1', contactId: null, ownerId: 'u1', title: 'Weighbridge', value: 100 });
    mockPrisma.opportunityStageHistory.create.mockResolvedValue({});
    await service.performAction('OP-1', 'Mark lost', { lost: 'Budget' }, directorUser);
    expect(mockPrisma.mfgActivity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ orgId: 'org-1', opportunityId: 'OP-1', ownerId: 'u1', type: 'Call', subject: expect.stringContaining('Budget') }),
    });
  });

  it('performAction "Mark lost" for a timing reason enrols the deal in opportunity_lost sequences', async () => {
    mockPrisma.opportunity.findFirst.mockResolvedValue({ id: 'OP-1', orgId: 'org-1', stage: 'Negotiation', createdAt: new Date() });
    mockPrisma.opportunityStageHistory.findFirst.mockResolvedValue(null);
    mockPrisma.opportunity.update.mockResolvedValue({ id: 'OP-1', orgId: 'org-1', accountId: 'a-1', contactId: null, ownerId: 'u1', title: 'W', value: 1 });
    mockPrisma.opportunityStageHistory.create.mockResolvedValue({});
    await service.performAction('OP-1', 'Mark lost', { lost: 'Budget' }, directorUser);
    expect(mockNurturing.enroll).toHaveBeenCalledWith('org-1', 'opportunity_lost', 'Opportunity', 'OP-1');
  });

  it('performAction "Mark lost" for Price books no re-engagement', async () => {
    mockPrisma.opportunity.findFirst.mockResolvedValue({ id: 'OP-1', orgId: 'org-1', stage: 'Negotiation', createdAt: new Date() });
    mockPrisma.opportunityStageHistory.findFirst.mockResolvedValue(null);
    mockPrisma.opportunity.update.mockResolvedValue({});
    mockPrisma.opportunityStageHistory.create.mockResolvedValue({});
    mockPrisma.mfgActivity.create.mockClear();
    await service.performAction('OP-1', 'Mark lost', { lost: 'Price' }, directorUser);
    expect(mockPrisma.mfgActivity.create).not.toHaveBeenCalled();
  });

  it('getTimelineEvents merges tasks, visits, trials, quotations and POs newest first, scoped to the org', async () => {
    mockPrisma.opportunity.findFirst.mockResolvedValue({ id: 'OP-1', orgId: 'org-1', stage: 'Qualified', createdAt: new Date() });
    mockPrisma.opportunityStageHistory.findFirst.mockResolvedValue(null);
    mockPrisma.mfgActivity.findMany.mockResolvedValue([{ id: 'a1', type: 'Call', subject: 'Intro', status: 'Done', outcome: 'Interested', dueDate: new Date('2026-10-01'), createdAt: new Date(), owner: { name: 'Asha' } }]);
    mockPrisma.siteVisit.findMany.mockResolvedValue([{ id: 'v1', title: 'Plant visit', visitDate: new Date('2026-10-05'), status: 'Completed' }]);
    mockPrisma.evaluation.findMany.mockResolvedValue([]);
    mockPrisma.quotation.findMany.mockResolvedValue([{ id: 'q1', version: 1, quotationDate: new Date('2026-10-09'), status: 'Sent' }]);
    mockPrisma.purchaseOrder.findMany.mockResolvedValue([]);
    const events = await service.getTimelineEvents('OP-1', directorUser);
    expect(events.map((e) => e.label)).toEqual(['Quotation v1', 'Site visit: Plant visit', 'Call: Intro']);
    expect(mockPrisma.quotation.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1', opportunityId: 'OP-1' }) }));
  });

  it('performAction "Advance stage" throws NotImplementedException', async () => {
    mockPrisma.opportunity.findFirst.mockResolvedValue({ id: 'OP-1', orgId: 'org-1', stage: 'Qualified', createdAt: new Date() });
    mockPrisma.opportunityStageHistory.findFirst.mockResolvedValue(null);
    await expect(service.performAction('OP-1', 'Advance stage', {}, directorUser)).rejects.toThrow(NotImplementedException);
  });

  it('findOne throws NotFoundException for a record outside the org', async () => {
    mockPrisma.opportunity.findFirst.mockResolvedValue(null);
    await expect(service.findOne('OP-1', directorUser)).rejects.toThrow(NotFoundException);
    expect(mockPrisma.opportunity.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'OP-1', orgId: 'org-1' }) }),
    );
  });

  it('getHistoryEvents maps stage history rows to EventItems', async () => {
    mockPrisma.opportunity.findFirst.mockResolvedValue({ id: 'OP-1', orgId: 'org-1', createdAt: new Date() });
    mockPrisma.opportunityStageHistory.findFirst.mockResolvedValue(null);
    mockPrisma.opportunityStageHistory.findMany.mockResolvedValue([
      { id: 'H-1', fromStage: null, toStage: 'Qualified', changedAt: new Date('2026-09-01'), changedBy: { name: 'Rep' } },
      { id: 'H-2', fromStage: 'Qualified', toStage: 'Negotiation', changedAt: new Date('2026-09-15'), changedBy: null },
    ]);
    const events = await service.getHistoryEvents('OP-1', directorUser);
    expect(events).toEqual([
      { id: 'H-1', at: new Date('2026-09-01').toISOString(), label: 'Created at Qualified', actor: 'Rep' },
      { id: 'H-2', at: new Date('2026-09-15').toISOString(), label: 'Qualified → Negotiation', actor: undefined },
    ]);
  });

  describe('findOne — computed fields', () => {
    it('computes age from createdAt', async () => {
      const createdAt = new Date(Date.now() - 5 * 86400000);
      mockPrisma.opportunity.findFirst.mockResolvedValue({ id: 'op-1', orgId: 'org-1', stage: 'Qualified', createdAt });
      mockPrisma.opportunityStageHistory.findFirst.mockResolvedValue(null);
      const result = await service.findOne('op-1', managerUser);
      expect(result.age).toBe(5);
    });

    it('attaches the sla state from SlaEngineService', async () => {
      const createdAt = new Date(Date.now() - 5 * 86400000);
      mockPrisma.opportunity.findFirst.mockResolvedValue({ id: 'op-1', orgId: 'org-1', stage: 'Qualified', createdAt });
      mockPrisma.opportunityStageHistory.findFirst.mockResolvedValue(null);
      mockSlaEngine.getSlaState.mockResolvedValue({ l: 'Due in 2d', t: 'green' });
      const result = await service.findOne('op-1', managerUser);
      expect(result.sla).toEqual({ l: 'Due in 2d', t: 'green' });
      expect(mockSlaEngine.getSlaState).toHaveBeenCalledWith('org-1', 'Opportunity', 'op-1');
    });

    it('computes daysInStage from the latest stage-history row when one exists', async () => {
      const createdAt = new Date(Date.now() - 30 * 86400000);
      const changedAt = new Date(Date.now() - 2 * 86400000);
      mockPrisma.opportunity.findFirst.mockResolvedValue({ id: 'op-1', orgId: 'org-1', stage: 'Negotiation', createdAt });
      mockPrisma.opportunityStageHistory.findFirst.mockResolvedValue({ changedAt });
      const result = await service.findOne('op-1', managerUser);
      expect(result.daysInStage).toBe(2);
      expect(result.age).toBe(30);
    });

    it('falls back to createdAt for daysInStage when no stage-history row exists yet', async () => {
      const createdAt = new Date(Date.now() - 3 * 86400000);
      mockPrisma.opportunity.findFirst.mockResolvedValue({ id: 'op-1', orgId: 'org-1', stage: 'Qualified', createdAt });
      mockPrisma.opportunityStageHistory.findFirst.mockResolvedValue(null);
      const result = await service.findOne('op-1', managerUser);
      expect(result.daysInStage).toBe(3);
    });
  });

  describe('update — active-state and stage-history rules', () => {
    it('does not require nextAction/nextActionDate when stage is absent from the update', async () => {
      const existing = { id: 'op-1', orgId: 'org-1', stage: 'Qualified', createdAt: new Date() };
      mockPrisma.opportunity.findFirst.mockResolvedValue(existing);
      mockPrisma.opportunityStageHistory.findFirst.mockResolvedValue(null);
      mockPrisma.opportunity.update.mockResolvedValue({ id: 'op-1' });
      await expect(service.update('op-1', { value: 500000 } as any, managerUser)).resolves.toBeDefined();
    });

    it('requires nextAction and nextActionDate when moving to a non-terminal stage', async () => {
      const existing = { id: 'op-1', orgId: 'org-1', stage: 'Qualified', createdAt: new Date() };
      mockPrisma.opportunity.findFirst.mockResolvedValue(existing);
      mockPrisma.opportunityStageHistory.findFirst.mockResolvedValue(null);
      await expect(
        service.update('op-1', { stage: 'Requirement collected' } as any, managerUser),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a next action date in the past when advancing the stage', async () => {
      const existing = { id: 'op-1', orgId: 'org-1', stage: 'Qualified', createdAt: new Date() };
      mockPrisma.opportunity.findFirst.mockResolvedValue(existing);
      mockPrisma.opportunityStageHistory.findFirst.mockResolvedValue(null);
      await expect(
        service.update('op-1', { stage: 'Requirement collected', nextAction: 'Call', nextActionDate: '2020-01-01' } as any, managerUser),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.opportunity.update).not.toHaveBeenCalled();
    });

    it('rejects moving to Won via update() — must go through the "Mark won" action', async () => {
      const existing = { id: 'op-1', orgId: 'org-1', stage: 'Negotiation', createdAt: new Date() };
      mockPrisma.opportunity.findFirst.mockResolvedValue(existing);
      mockPrisma.opportunityStageHistory.findFirst.mockResolvedValue(null);
      await expect(service.update('op-1', { stage: 'Won' } as any, managerUser)).rejects.toThrow(BadRequestException);
      expect(mockPrisma.opportunity.update).not.toHaveBeenCalled();
    });

    it('rejects moving to Lost via update() — must go through the "Mark lost" action', async () => {
      const existing = { id: 'op-1', orgId: 'org-1', stage: 'Negotiation', createdAt: new Date() };
      mockPrisma.opportunity.findFirst.mockResolvedValue(existing);
      mockPrisma.opportunityStageHistory.findFirst.mockResolvedValue(null);
      await expect(service.update('op-1', { stage: 'Lost' } as any, managerUser)).rejects.toThrow(BadRequestException);
      expect(mockPrisma.opportunity.update).not.toHaveBeenCalled();
    });

    it('writes an OpportunityStageHistory row when stage actually changes', async () => {
      const existing = { id: 'op-1', orgId: 'org-1', stage: 'Qualified', createdAt: new Date() };
      mockPrisma.opportunity.findFirst.mockResolvedValue(existing);
      mockPrisma.opportunityStageHistory.findFirst.mockResolvedValue(null);
      mockPrisma.opportunity.update.mockResolvedValue({ id: 'op-1', stage: 'Requirement collected' });
      await service.update(
        'op-1',
        { stage: 'Requirement collected', nextAction: 'Call', nextActionDate: '2099-01-01' } as any,
        managerUser,
      );
      expect(mockPrisma.opportunityStageHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ opportunityId: 'op-1', fromStage: 'Qualified', toStage: 'Requirement collected' }) }),
      );
    });

    it('does not write a stage-history row when stage is unchanged', async () => {
      const existing = { id: 'op-1', orgId: 'org-1', stage: 'Qualified', createdAt: new Date() };
      mockPrisma.opportunity.findFirst.mockResolvedValue(existing);
      mockPrisma.opportunityStageHistory.findFirst.mockResolvedValue(null);
      mockPrisma.opportunity.update.mockResolvedValue({ id: 'op-1' });
      await service.update('op-1', { stage: 'Qualified', nextAction: 'Call', nextActionDate: '2099-01-01' } as any, managerUser);
      expect(mockPrisma.opportunityStageHistory.create).not.toHaveBeenCalled();
    });
  });

  describe('probability, history, lost reasons and closed deals', () => {
    it('shows the win probability that goes with the stage, on the record and in the list', async () => {
      mockPrisma.opportunityStageHistory.findFirst.mockResolvedValue(null);
      mockPrisma.opportunity.findFirst.mockResolvedValue({ id: 'op-1', orgId: 'org-1', stage: 'Negotiation', createdAt: new Date() });
      expect((await service.findOne('op-1', directorUser)).prob).toBe(60);
      mockPrisma.opportunity.count.mockResolvedValue(2);
      mockPrisma.opportunity.findMany.mockResolvedValue([
        { id: 'a', orgId: 'org-1', stage: 'Qualified', createdAt: new Date() },
        { id: 'b', orgId: 'org-1', stage: 'PO received', createdAt: new Date() },
      ]);
      const list = await service.findAll({ page: 1, limit: 20 }, directorUser);
      expect(list.data.map((r) => r.prob)).toEqual([10, 95]);
    });

    it('create writes the first history row and starts the stagnation timer for the first stage', async () => {
      mockPrisma.account.findFirst.mockResolvedValue({ id: 'A-1' });
      mockPrisma.opportunity.create.mockResolvedValue({ id: 'op-9', orgId: 'org-1', stage: 'Qualified', value: 100000 });
      await service.create(validCreateDto as never, directorUser);
      expect(mockPrisma.opportunity.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ stageHistory: { create: { fromStage: null, toStage: 'Qualified', changedById: 'dir-1' } } }),
      });
      expect(mockSlaEngine.startTimer).toHaveBeenCalledWith('org-1', 'opps', 'Opportunity', 'op-9', 'Stage entered', 'Qualified', 100000);
    });

    it('Mark lost only accepts a reason from the lost-reason list, and trims it', async () => {
      mockPrisma.opportunity.findFirst.mockResolvedValue({ id: 'OP-1', orgId: 'org-1', stage: 'Negotiation', createdAt: new Date() });
      mockPrisma.opportunityStageHistory.findFirst.mockResolvedValue(null);
      await expect(service.performAction('OP-1', 'Mark lost', { lost: '   ' }, directorUser)).rejects.toThrow(/'lost' is required/);
      await expect(service.performAction('OP-1', 'Mark lost', { lost: 'Alien invasion' }, directorUser)).rejects.toThrow(/not a valid lost reason/);
      expect(mockPrisma.opportunity.update).not.toHaveBeenCalled();
      mockPrisma.opportunity.update.mockResolvedValue({});
      mockPrisma.opportunityStageHistory.create.mockResolvedValue({});
      await service.performAction('OP-1', 'Mark lost', { lost: ' Budget ' }, directorUser);
      expect(mockPrisma.opportunity.update).toHaveBeenCalledWith({ where: { id: 'OP-1' }, data: { stage: 'Lost', lostReason: 'Budget' } });
    });

    it('a Won or Lost opportunity cannot be moved to another stage by editing, but other fields can change', async () => {
      mockPrisma.opportunity.findFirst.mockResolvedValue({ id: 'op-1', orgId: 'org-1', stage: 'Lost', createdAt: new Date() });
      mockPrisma.opportunityStageHistory.findFirst.mockResolvedValue(null);
      await expect(
        service.update('op-1', { stage: 'Negotiation', nextAction: 'x', nextActionDate: '2099-01-01' } as never, managerUser),
      ).rejects.toThrow(/can't be moved to another stage/);
      expect(mockPrisma.opportunity.update).not.toHaveBeenCalled();
      mockPrisma.opportunity.update.mockResolvedValue({ id: 'op-1' });
      await service.update('op-1', { competitor: 'Mettler Toledo' } as never, managerUser);
      expect(mockPrisma.opportunity.update).toHaveBeenCalled();
    });
  });
});
