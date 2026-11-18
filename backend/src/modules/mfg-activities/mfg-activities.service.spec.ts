import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { MfgActivitiesService } from './mfg-activities.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SlaEngineService } from '../sla-timers/sla-engine.service';
import type { AuthUser } from '../../common/types/auth-user.type';

const mockSlaEngine = {
  startTimer: jest.fn().mockResolvedValue(undefined),
  stopTimer: jest.fn().mockResolvedValue(undefined),
  getSlaState: jest.fn().mockResolvedValue(null),
};

const mockPrisma = {
  mfgActivity: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn() },
  account: { findFirst: jest.fn() },
  opportunity: { findFirst: jest.fn() },
  contact: { findFirst: jest.fn() },
  mfgLead: { findFirst: jest.fn() },
};

const repUser: AuthUser = { id: 'rep-1', name: 'Rep', email: 'rep@test.com', role: Role.SALES_REP, teamId: 'team-1', orgId: 'org-1' };
const managerUser: AuthUser = { id: 'mgr-1', name: 'Mgr', email: 'mgr@test.com', role: Role.MANAGER, teamId: 'team-1', orgId: 'org-1' };
const directorUser: AuthUser = { id: 'dir-1', name: 'Dir', email: 'dir@test.com', role: Role.DIRECTOR, teamId: null, orgId: 'org-1' };

describe('MfgActivitiesService', () => {
  let service: MfgActivitiesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        MfgActivitiesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SlaEngineService, useValue: mockSlaEngine },
      ],
    }).compile();
    service = module.get(MfgActivitiesService);
  });

  it('scopes findAll to ownerId for SALES_REP', async () => {
    mockPrisma.mfgActivity.count.mockResolvedValue(0);
    mockPrisma.mfgActivity.findMany.mockResolvedValue([]);
    await service.findAll({ page: 1, limit: 20 }, repUser);
    expect(mockPrisma.mfgActivity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1', ownerId: 'rep-1', isDeleted: false }) }),
    );
  });

  it('does not scope findAll to ownerId for MANAGER', async () => {
    mockPrisma.mfgActivity.count.mockResolvedValue(0);
    mockPrisma.mfgActivity.findMany.mockResolvedValue([]);
    await service.findAll({ page: 1, limit: 20 }, managerUser);
    const where = mockPrisma.mfgActivity.findMany.mock.calls[0][0].where;
    expect(where.ownerId).toBeUndefined();
    expect(where.orgId).toBe('org-1');
  });

  it('does not scope findAll to ownerId for DIRECTOR', async () => {
    mockPrisma.mfgActivity.count.mockResolvedValue(0);
    mockPrisma.mfgActivity.findMany.mockResolvedValue([]);
    await service.findAll({ page: 1, limit: 20 }, directorUser);
    const where = mockPrisma.mfgActivity.findMany.mock.calls[0][0].where;
    expect(where.ownerId).toBeUndefined();
  });

  it('SALES_REP passing ?owner=<other-rep> still only sees their own records', async () => {
    mockPrisma.mfgActivity.count.mockResolvedValue(0);
    mockPrisma.mfgActivity.findMany.mockResolvedValue([]);
    await service.findAll({ page: 1, limit: 20, ownerId: ['other-rep-id'] }, repUser);
    const where = mockPrisma.mfgActivity.findMany.mock.calls[0][0].where;
    expect(where.ownerId).toBe('rep-1');
  });

  it('create defaults ownerId to the caller for a SALES_REP when omitted', async () => {
    mockPrisma.mfgActivity.create.mockResolvedValue({ id: 'T-1' });
    await service.create({ type: 'Call', subject: 'Follow up', priority: 'High' } as never, repUser);
    expect(mockPrisma.mfgActivity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ ownerId: 'rep-1' }),
    });
  });

  it('create throws ForbiddenException when caller has no orgId', async () => {
    const noOrgUser = { ...directorUser, orgId: null } as unknown as AuthUser;
    await expect(
      service.create({ type: 'Call', subject: 'Follow up', priority: 'High' } as never, noOrgUser),
    ).rejects.toThrow(ForbiddenException);
  });

  it('create rejects an accountId belonging to a different org', async () => {
    mockPrisma.account.findFirst.mockResolvedValue(null);
    await expect(
      service.create({ type: 'Call', subject: 'Follow up', priority: 'High', accountId: 'A-evil' } as never, directorUser),
    ).rejects.toThrow(BadRequestException);
  });

  it('create rejects a dueDate in the past', async () => {
    await expect(
      service.create({ type: 'Call', subject: 'Follow up', priority: 'High', dueDate: '2020-01-01' } as never, repUser),
    ).rejects.toThrow(BadRequestException);
    expect(mockPrisma.mfgActivity.create).not.toHaveBeenCalled();
  });

  it('create converts a date-only dueDate string into a real Date instance', async () => {
    mockPrisma.mfgActivity.create.mockResolvedValue({ id: 'T-1' });
    await service.create(
      { type: 'Call', subject: 'Follow up', priority: 'High', dueDate: '2099-10-01' } as never,
      directorUser,
    );
    expect(mockPrisma.mfgActivity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ dueDate: expect.any(Date) }),
    });
  });

  it('filters findAll by accountId when passed', async () => {
    mockPrisma.mfgActivity.count.mockResolvedValue(0);
    mockPrisma.mfgActivity.findMany.mockResolvedValue([]);
    await service.findAll({ page: 1, limit: 20, accountId: 'A-1' }, directorUser);
    expect(mockPrisma.mfgActivity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ accountId: 'A-1' }) }),
    );
  });

  it('findOne throws NotFoundException when the record is outside the org', async () => {
    mockPrisma.mfgActivity.findFirst.mockResolvedValue(null);
    await expect(service.findOne('T-1', directorUser)).rejects.toThrow(NotFoundException);
    expect(mockPrisma.mfgActivity.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'T-1', orgId: 'org-1' }) }),
    );
  });

  it('performAction "Complete" requires an outcome', async () => {
    mockPrisma.mfgActivity.findFirst.mockResolvedValue({ id: 'T-1', orgId: 'org-1', status: 'Open' });
    await expect(service.performAction('T-1', 'Complete', {}, directorUser)).rejects.toThrow(BadRequestException);
  });

  it('performAction "Complete" sets status and outcome when provided', async () => {
    mockPrisma.mfgActivity.findFirst.mockResolvedValue({ id: 'T-1', orgId: 'org-1', status: 'Open' });
    mockPrisma.mfgActivity.update.mockResolvedValue({ id: 'T-1', orgId: 'org-1', status: 'Completed', outcome: 'Went well' });
    await service.performAction('T-1', 'Complete', { outcome: 'Went well' }, directorUser);
    expect(mockPrisma.mfgActivity.update).toHaveBeenCalledWith({
      where: { id: 'T-1' },
      data: { status: 'Completed', outcome: 'Went well' },
    });
  });

  it('performAction "Complete" stops the SLA-06 timer on the activity itself', async () => {
    mockPrisma.mfgActivity.findFirst.mockResolvedValue({ id: 'T-1', orgId: 'org-1', status: 'Open' });
    mockPrisma.mfgActivity.update.mockResolvedValue({ id: 'T-1', orgId: 'org-1', status: 'Completed' });
    await service.performAction('T-1', 'Complete', { outcome: 'Went well' }, directorUser);
    expect(mockSlaEngine.stopTimer).toHaveBeenCalledWith('org-1', 'activities', 'MfgActivity', 'T-1', 'Activity completed');
  });

  it('performAction "Complete" also stops the SLA-05 timer on the linked opportunity, when present', async () => {
    mockPrisma.mfgActivity.findFirst.mockResolvedValue({ id: 'T-1', orgId: 'org-1', status: 'Open', opportunityId: 'opp-1' });
    mockPrisma.mfgActivity.update.mockResolvedValue({ id: 'T-1', orgId: 'org-1', status: 'Completed' });
    await service.performAction('T-1', 'Complete', { outcome: 'Went well' }, directorUser);
    expect(mockSlaEngine.stopTimer).toHaveBeenCalledWith('org-1', 'opps', 'Opportunity', 'opp-1', 'Activity completed');
  });

  it('performAction "Complete" does not touch the opportunity SLA when the activity has no opportunityId', async () => {
    mockPrisma.mfgActivity.findFirst.mockResolvedValue({ id: 'T-1', orgId: 'org-1', status: 'Open' });
    mockPrisma.mfgActivity.update.mockResolvedValue({ id: 'T-1', orgId: 'org-1', status: 'Completed' });
    await service.performAction('T-1', 'Complete', { outcome: 'Went well' }, directorUser);
    expect(mockSlaEngine.stopTimer).not.toHaveBeenCalledWith('org-1', 'opps', expect.anything(), expect.anything(), expect.anything());
  });

  it('performAction "Cancel" is rejected when the activity is already Completed', async () => {
    mockPrisma.mfgActivity.findFirst.mockResolvedValue({ id: 'T-1', orgId: 'org-1', status: 'Completed' });
    await expect(service.performAction('T-1', 'Cancel', {}, directorUser)).rejects.toThrow(BadRequestException);
  });

  it('archive sets isDeleted true', async () => {
    mockPrisma.mfgActivity.findFirst.mockResolvedValue({ id: 'T-1', orgId: 'org-1' });
    mockPrisma.mfgActivity.update.mockResolvedValue({});
    await service.archive('T-1', directorUser);
    expect(mockPrisma.mfgActivity.update).toHaveBeenCalledWith({ where: { id: 'T-1' }, data: { isDeleted: true } });
  });

  it('Complete treats an outcome of only spaces as missing, and stores the trimmed outcome', async () => {
    mockPrisma.mfgActivity.findFirst.mockResolvedValue({ id: 'T-1', orgId: 'org-1', status: 'Open' });
    await expect(service.performAction('T-1', 'Complete', { outcome: '   ' }, directorUser)).rejects.toThrow(/'outcome' is required/);
    expect(mockPrisma.mfgActivity.update).not.toHaveBeenCalled();
    mockPrisma.mfgActivity.update.mockResolvedValue({ id: 'T-1', orgId: 'org-1', status: 'Completed' });
    await service.performAction('T-1', 'Complete', { outcome: '  Demo booked ' }, directorUser);
    expect(mockPrisma.mfgActivity.update).toHaveBeenCalledWith({ where: { id: 'T-1' }, data: { status: 'Completed', outcome: 'Demo booked' } });
  });

  it('create fills the account from the linked opportunity, and an explicit account wins', async () => {
    mockPrisma.opportunity.findFirst.mockResolvedValue({ id: 'O-1', accountId: 'A-opp' });
    mockPrisma.account.findFirst.mockResolvedValue({ id: 'A-chosen' });
    mockPrisma.mfgActivity.create.mockResolvedValue({ id: 'T-1' });
    await service.create({ type: 'Call', subject: 'S', priority: 'Low', dueDate: '2099-01-01', opportunityId: 'O-1' } as never, directorUser);
    expect(mockPrisma.mfgActivity.create).toHaveBeenLastCalledWith({ data: expect.objectContaining({ accountId: 'A-opp' }) });
    await service.create({ type: 'Call', subject: 'S', priority: 'Low', dueDate: '2099-01-01', opportunityId: 'O-1', accountId: 'A-chosen' } as never, directorUser);
    expect(mockPrisma.mfgActivity.create).toHaveBeenLastCalledWith({ data: expect.objectContaining({ accountId: 'A-chosen' }) });
  });
});
