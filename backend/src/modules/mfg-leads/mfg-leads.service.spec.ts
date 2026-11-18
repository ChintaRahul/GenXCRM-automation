import { AutomationEngineService } from '../automation-rules/automation-engine.service';
import { MfgNurturingService } from '../nurturing/mfg-nurturing.service';
import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { MfgLeadsService } from './mfg-leads.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SlaEngineService } from '../sla-timers/sla-engine.service';
import type { AuthUser } from '../../common/types/auth-user.type';

const mockPrisma = {
  mfgLead: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn(), groupBy: jest.fn() },
  account: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn() },
  contact: { findFirst: jest.fn(), create: jest.fn() },
  opportunity: { create: jest.fn() },
  mfgActivity: { updateMany: jest.fn() },
  rolePermission: { findFirst: jest.fn() },
  user: { findMany: jest.fn() },
  $transaction: jest.fn((cb) => cb(mockPrisma)),
};

const mockSlaEngine = {
  startTimer: jest.fn().mockResolvedValue(undefined),
  stopTimer: jest.fn().mockResolvedValue(undefined),
  getSlaState: jest.fn().mockResolvedValue(null),
};

const repUser: AuthUser = { id: 'rep-1', name: 'Rep', email: 'rep@test.com', role: Role.SALES_REP, teamId: 'team-1', orgId: 'org-1' };
const managerUser: AuthUser = { id: 'mgr-1', name: 'Mgr', email: 'mgr@test.com', role: Role.MANAGER, teamId: 'team-1', orgId: 'org-1' };
const directorUser: AuthUser = { id: 'dir-1', name: 'Dir', email: 'dir@test.com', role: Role.DIRECTOR, teamId: null, orgId: 'org-1' };

const BANT = { qBudget: 'Approved', qAuth: 'Decision maker engaged', qNeed: 'Critical', qTime: 'This quarter' };

const mockNurturing = { enroll: jest.fn().mockResolvedValue(undefined), endEnrollments: jest.fn().mockResolvedValue(undefined) };

const mockAutomation = { fire: jest.fn().mockResolvedValue(undefined) };

describe('MfgLeadsService', () => {
  let service: MfgLeadsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.mfgLead.findFirst.mockReset();
    mockPrisma.user.findMany.mockResolvedValue([]);
    mockPrisma.mfgLead.groupBy.mockResolvedValue([]);
    const module = await Test.createTestingModule({
      providers: [
        MfgLeadsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SlaEngineService, useValue: mockSlaEngine },
        { provide: AutomationEngineService, useValue: mockAutomation },
        { provide: MfgNurturingService, useValue: mockNurturing },
      ],
    }).compile();
    service = module.get(MfgLeadsService);
  });

  it('searches company, phone and email', async () => {
    mockPrisma.mfgLead.count.mockResolvedValue(0);
    mockPrisma.mfgLead.findMany.mockResolvedValue([]);
    await service.findAll({ page: 1, limit: 20, search: 'buyer@x.in' }, repUser);
    const { where } = mockPrisma.mfgLead.findMany.mock.calls[0][0];
    expect(where.OR).toEqual(expect.arrayContaining([{ email: { contains: 'buyer@x.in', mode: 'insensitive' } }]));
  });

  it('scopes findAll to ownerId for SALES_REP', async () => {
    mockPrisma.mfgLead.count.mockResolvedValue(0);
    mockPrisma.mfgLead.findMany.mockResolvedValue([]);
    await service.findAll({ page: 1, limit: 20 }, repUser);
    expect(mockPrisma.mfgLead.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1', ownerId: 'rep-1' }) }),
    );
  });

  it('scopes findAll to ownerId for an mfgRole with OWN record access', async () => {
    mockPrisma.rolePermission.findFirst.mockResolvedValue({ recordAccess: 'OWN' });
    mockPrisma.mfgLead.count.mockResolvedValue(0);
    mockPrisma.mfgLead.findMany.mockResolvedValue([]);
    await service.findAll({ page: 1, limit: 20 }, { ...directorUser, mfgRole: 'SALES_EXECUTIVE' });
    expect(mockPrisma.rolePermission.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orgId: 'org-1', role: 'SALES_EXECUTIVE', moduleKey: 'leads', isDeleted: false } }),
    );
    expect(mockPrisma.mfgLead.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ ownerId: 'dir-1' }) }),
    );
  });

  it('scopes findAll to the team for an mfgRole with TEAM record access', async () => {
    mockPrisma.rolePermission.findFirst.mockResolvedValue({ recordAccess: 'TEAM' });
    mockPrisma.user.findMany.mockResolvedValue([{ id: 'mgr-1' }, { id: 'rep-1' }]);
    mockPrisma.mfgLead.count.mockResolvedValue(0);
    mockPrisma.mfgLead.findMany.mockResolvedValue([]);
    await service.findAll({ page: 1, limit: 20 }, { ...managerUser, mfgRole: 'SALES_MANAGER' });
    expect(mockPrisma.mfgLead.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ ownerId: { in: ['mgr-1', 'rep-1'] } }) }),
    );
  });

  it('does not scope findAll for an mfgRole with ALL record access', async () => {
    mockPrisma.rolePermission.findFirst.mockResolvedValue({ recordAccess: 'ALL' });
    mockPrisma.mfgLead.count.mockResolvedValue(0);
    mockPrisma.mfgLead.findMany.mockResolvedValue([]);
    await service.findAll({ page: 1, limit: 20 }, { ...repUser, mfgRole: 'SALES_HEAD' });
    const where = mockPrisma.mfgLead.findMany.mock.calls.at(-1)![0].where;
    expect(where.ownerId).toBeUndefined();
  });

  it('create defaults status to New', async () => {
    mockPrisma.mfgLead.create.mockResolvedValue({ id: 'LD-1', orgId: 'org-1' });
    await service.create(
      { company: 'Acme', contactName: 'Jo', phone: '9999999999', product: 'Conveyor', source: 'Website' } as never,
      directorUser,
    );
    expect(mockPrisma.mfgLead.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ orgId: 'org-1', status: 'New' }),
    });
  });

  it('create starts the SLA-01 "Lead first response" timer, with source and value driving its targets', async () => {
    mockPrisma.mfgLead.create.mockResolvedValue({ id: 'LD-1', orgId: 'org-1', source: 'Website', value: 200000 });
    await service.create(
      { company: 'Acme', contactName: 'Jo', phone: '9999999999', product: 'Conveyor', source: 'Website' } as never,
      directorUser,
    );
    expect(mockSlaEngine.startTimer).toHaveBeenCalledWith('org-1', 'leads', 'MfgLead', 'LD-1', 'Lead created', 'Website', 200000);
  });

  it('findAll attaches the sla state from SlaEngineService to each row', async () => {
    mockPrisma.mfgLead.count.mockResolvedValue(1);
    mockPrisma.mfgLead.findMany.mockResolvedValue([{ id: 'LD-1', orgId: 'org-1' }]);
    mockSlaEngine.getSlaState.mockResolvedValue({ l: 'Due in 1h', t: 'green' });
    const result = await service.findAll({ page: 1, limit: 20 }, directorUser);
    expect(result.data[0]).toMatchObject({ id: 'LD-1', sla: { l: 'Due in 1h', t: 'green' } });
    expect(mockSlaEngine.getSlaState).toHaveBeenCalledWith('org-1', 'MfgLead', 'LD-1');
  });

  it('does not scope findAll to ownerId for MANAGER', async () => {
    mockPrisma.mfgLead.count.mockResolvedValue(0);
    mockPrisma.mfgLead.findMany.mockResolvedValue([]);
    await service.findAll({ page: 1, limit: 20 }, managerUser);
    const where = mockPrisma.mfgLead.findMany.mock.calls[0][0].where;
    expect(where.ownerId).toBeUndefined();
    expect(where.orgId).toBe('org-1');
  });

  it('does not scope findAll to ownerId for DIRECTOR', async () => {
    mockPrisma.mfgLead.count.mockResolvedValue(0);
    mockPrisma.mfgLead.findMany.mockResolvedValue([]);
    await service.findAll({ page: 1, limit: 20 }, directorUser);
    const where = mockPrisma.mfgLead.findMany.mock.calls[0][0].where;
    expect(where.ownerId).toBeUndefined();
  });

  it('SALES_REP passing ?owner=<other-rep> still only sees their own records', async () => {
    mockPrisma.mfgLead.count.mockResolvedValue(0);
    mockPrisma.mfgLead.findMany.mockResolvedValue([]);
    await service.findAll({ page: 1, limit: 20, ownerId: ['other-rep-id'] }, repUser);
    const where = mockPrisma.mfgLead.findMany.mock.calls[0][0].where;
    expect(where.ownerId).toBe('rep-1');
  });

  it('create defaults ownerId to the caller for a SALES_REP when omitted', async () => {
    mockPrisma.mfgLead.create.mockResolvedValue({ id: 'LD-1' });
    await service.create(
      { company: 'Acme', contactName: 'Jo', phone: '9999999999', product: 'Conveyor', source: 'Website' } as never,
      repUser,
    );
    expect(mockPrisma.mfgLead.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ ownerId: 'rep-1' }),
    });
  });

  it('create throws ForbiddenException when caller has no orgId', async () => {
    const noOrgUser = { ...directorUser, orgId: null } as unknown as AuthUser;
    await expect(
      service.create(
        { company: 'Acme', contactName: 'Jo', phone: '9999999999', product: 'Conveyor', source: 'Website' } as never,
        noOrgUser,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('create converts a date-only nextDate string into a real Date instance', async () => {
    mockPrisma.mfgLead.create.mockResolvedValue({ id: 'LD-1' });
    await service.create(
      {
        company: 'Acme',
        contactName: 'Jo',
        phone: '9999999999',
        product: 'Conveyor',
        source: 'Website',
        nextDate: '2026-10-01',
      } as never,
      directorUser,
    );
    expect(mockPrisma.mfgLead.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ nextDate: expect.any(Date) }),
    });
  });

  it('performAction "Mark contacted" transitions New -> Contacted', async () => {
    mockPrisma.mfgLead.findFirst.mockResolvedValue({ id: 'LD-1', orgId: 'org-1', status: 'New' });
    mockPrisma.mfgLead.update.mockResolvedValue({ id: 'LD-1', orgId: 'org-1', status: 'Contacted' });
    await service.performAction('LD-1', 'Mark contacted', {}, directorUser);
    expect(mockPrisma.mfgLead.update).toHaveBeenCalledWith({ where: { id: 'LD-1' }, data: { status: 'Contacted' } });
  });

  it('performAction "Mark contacted" stops SLA-01 and starts SLA-02', async () => {
    mockPrisma.mfgLead.findFirst.mockResolvedValue({ id: 'LD-1', orgId: 'org-1', status: 'New' });
    mockPrisma.mfgLead.update.mockResolvedValue({ id: 'LD-1', orgId: 'org-1', status: 'Contacted' });
    await service.performAction('LD-1', 'Mark contacted', {}, directorUser);
    expect(mockSlaEngine.stopTimer).toHaveBeenCalledWith('org-1', 'leads', 'MfgLead', 'LD-1', 'First call / message logged');
    expect(mockSlaEngine.startTimer).toHaveBeenCalledWith('org-1', 'leads', 'MfgLead', 'LD-1', 'Lead contacted');
  });

  it('performAction "Qualify" stops SLA-02', async () => {
    mockPrisma.mfgLead.findFirst.mockResolvedValue({ id: 'LD-1', orgId: 'org-1', status: 'Contacted', ...BANT });
    mockPrisma.mfgLead.update.mockResolvedValue({ id: 'LD-1', orgId: 'org-1', status: 'Qualified' });
    await service.performAction('LD-1', 'Qualify', {}, directorUser);
    expect(mockSlaEngine.stopTimer).toHaveBeenCalledWith('org-1', 'leads', 'MfgLead', 'LD-1', 'Qualified / Nurture / Disqualified');
  });

  it('performAction "Mark contacted" rejects from Qualified', async () => {
    mockPrisma.mfgLead.findFirst.mockResolvedValue({ id: 'LD-1', orgId: 'org-1', status: 'Qualified' });
    await expect(service.performAction('LD-1', 'Mark contacted', {}, directorUser)).rejects.toThrow(BadRequestException);
  });

  it('performAction "Disqualify" requires the disq payload key', async () => {
    mockPrisma.mfgLead.findFirst.mockResolvedValue({ id: 'LD-1', orgId: 'org-1', status: 'New' });
    await expect(service.performAction('LD-1', 'Disqualify', {}, directorUser)).rejects.toThrow(BadRequestException);
  });

  it('performAction "Disqualify" sets disqualifyReason from the disq payload key', async () => {
    mockPrisma.mfgLead.findFirst.mockResolvedValue({ id: 'LD-1', orgId: 'org-1', status: 'New' });
    mockPrisma.mfgLead.update.mockResolvedValue({});
    await service.performAction('LD-1', 'Disqualify', { disq: 'Budget' }, directorUser);
    expect(mockPrisma.mfgLead.update).toHaveBeenCalledWith({
      where: { id: 'LD-1' },
      data: { status: 'Disqualified', disqualifyReason: 'Budget' },
    });
  });

  it('findOne throws NotFoundException for a record outside the org', async () => {
    mockPrisma.mfgLead.findFirst.mockResolvedValue(null);
    await expect(service.findOne('LD-1', directorUser)).rejects.toThrow(NotFoundException);
    expect(mockPrisma.mfgLead.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'LD-1', orgId: 'org-1' }) }),
    );
  });

  describe('convert', () => {
    const qualifiedLead = {
      id: 'ld-1', orgId: 'org-1', status: 'Qualified', company: 'Acme Pvt Ltd', contactName: 'Ravi Kumar',
      phone: '9876543210', email: 'ravi@acme.com', designation: 'Manager', product: 'Weighbridge',
      value: 500000, source: 'Website', ownerId: 'u9', city: 'Pune', state: 'Maharashtra',
    };

    it('rejects conversion when lead is not Qualified', async () => {
      mockPrisma.mfgLead.findFirst.mockResolvedValue({ ...qualifiedLead, status: 'New' });
      await expect(service.convert('ld-1', { contactRole: 'Decision Maker' }, managerUser)).rejects.toThrow(BadRequestException);
    });

    it('requires contactRole', async () => {
      mockPrisma.mfgLead.findFirst.mockResolvedValue(qualifiedLead);
      await expect(service.convert('ld-1', undefined, managerUser)).rejects.toThrow(BadRequestException);
    });

    it('requires account.type/industry/territory when no accountId is given', async () => {
      mockPrisma.mfgLead.findFirst.mockResolvedValue(qualifiedLead);
      await expect(service.convert('ld-1', { contactRole: 'Decision Maker' }, managerUser)).rejects.toThrow(BadRequestException);
    });

    it('rejects an accountId from another org', async () => {
      mockPrisma.mfgLead.findFirst.mockResolvedValue(qualifiedLead);
      mockPrisma.account.findFirst.mockResolvedValue(null);
      await expect(
        service.convert('ld-1', { contactRole: 'Decision Maker', accountId: 'other-org-acc' }, managerUser),
      ).rejects.toThrow(BadRequestException);
    });

    it('returns a duplicate marker when the normalized company name already matches an existing account', async () => {
      mockPrisma.mfgLead.findFirst.mockResolvedValue(qualifiedLead);
      mockPrisma.account.findMany.mockResolvedValue([{ id: 'acc-9', name: 'Acme Private Limited', gstin: null }]);
      const result = await service.convert(
        'ld-1',
        { contactRole: 'Decision Maker', account: { type: 'Prospect', industry: 'Steel & metals', territory: 'West' } },
        managerUser,
      );
      expect(result).toEqual({ duplicate: true, existingAccountId: 'acc-9' });
      expect(mockPrisma.account.create).not.toHaveBeenCalled();
    });

    it('returns a duplicate marker when an existing contact on the target account matches phone or email', async () => {
      mockPrisma.mfgLead.findFirst.mockResolvedValue(qualifiedLead);
      mockPrisma.account.findFirst.mockResolvedValue({ id: 'acc-1' });
      mockPrisma.contact.findFirst.mockResolvedValue({ id: 'ct-9' });
      const result = await service.convert('ld-1', { contactRole: 'Decision Maker', accountId: 'acc-1' }, managerUser);
      expect(result).toEqual({ duplicate: true, existingContactId: 'ct-9' });
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('creates a new account defaulting city/state from the lead when omitted', async () => {
      mockPrisma.mfgLead.findFirst.mockResolvedValue(qualifiedLead);
      mockPrisma.account.findMany.mockResolvedValue([]);
      mockPrisma.account.create.mockResolvedValue({ id: 'acc-new' });
      mockPrisma.contact.findFirst.mockResolvedValue(null);
      mockPrisma.contact.create.mockResolvedValue({ id: 'ct-new' });
      mockPrisma.opportunity.create.mockResolvedValue({ id: 'op-new' });
      mockPrisma.mfgLead.update.mockResolvedValue({ id: 'ld-1' });
      await service.convert(
        'ld-1',
        { contactRole: 'Decision Maker', account: { type: 'Prospect', industry: 'Steel & metals', territory: 'West' } },
        managerUser,
      );
      expect(mockPrisma.account.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ city: 'Pune', state: 'Maharashtra', orgId: 'org-1' }) }),
      );
    });

    it("gives the new account the lead's owner, so the rep who worked the lead can open it", async () => {
      mockPrisma.mfgLead.findFirst.mockResolvedValue({ ...qualifiedLead, ownerId: 'rep-7' });
      mockPrisma.account.findMany.mockResolvedValue([]);
      mockPrisma.account.create.mockResolvedValue({ id: 'acc-new' });
      mockPrisma.contact.findFirst.mockResolvedValue(null);
      mockPrisma.contact.create.mockResolvedValue({ id: 'ct-new' });
      mockPrisma.opportunity.create.mockResolvedValue({ id: 'op-new' });
      mockPrisma.mfgLead.update.mockResolvedValue({ id: 'ld-1' });
      await service.convert(
        'ld-1',
        { contactRole: 'Decision Maker', account: { type: 'Prospect', industry: 'Steel & metals', territory: 'West' } },
        managerUser,
      );
      expect(mockPrisma.account.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ ownerId: 'rep-7' }) }),
      );
    });

    it('happy path creates Contact + Opportunity in one transaction and sets lead status to Converted', async () => {
      mockPrisma.mfgLead.findFirst.mockResolvedValue(qualifiedLead);
      mockPrisma.account.findFirst.mockResolvedValue({ id: 'acc-1' });
      mockPrisma.contact.findFirst.mockResolvedValue(null);
      mockPrisma.contact.create.mockResolvedValue({ id: 'ct-new' });
      mockPrisma.opportunity.create.mockResolvedValue({ id: 'op-new' });
      mockPrisma.mfgLead.update.mockResolvedValue({ id: 'ld-1', status: 'Converted' });
      const result = await service.convert('ld-1', { contactRole: 'Decision Maker', accountId: 'acc-1' }, managerUser);
      expect(mockPrisma.contact.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ accountId: 'acc-1', role: 'Decision Maker', phone: '9876543210' }) }),
      );
      expect(mockPrisma.opportunity.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ accountId: 'acc-1', contactId: 'ct-new', stage: 'Qualified' }) }),
      );
      expect(mockPrisma.mfgLead.update).toHaveBeenCalledWith({ where: { id: 'ld-1' }, data: { status: 'Converted' } });
      expect(result).toEqual({ accountId: 'acc-1', contactId: 'ct-new', opportunityId: 'op-new' });
    });

    it('scopes the contact-dedup lookup to orgId', async () => {
      mockPrisma.mfgLead.findFirst.mockResolvedValue(qualifiedLead);
      mockPrisma.account.findFirst.mockResolvedValue({ id: 'acc-1' });
      mockPrisma.contact.findFirst.mockResolvedValue(null);
      mockPrisma.contact.create.mockResolvedValue({ id: 'ct-new' });
      mockPrisma.opportunity.create.mockResolvedValue({ id: 'op-new' });
      mockPrisma.mfgLead.update.mockResolvedValue({ id: 'ld-1' });
      await service.convert('ld-1', { contactRole: 'Decision Maker', accountId: 'acc-1' }, managerUser);
      expect(mockPrisma.contact.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1' }) }),
      );
    });

    it('rejects converting onto a soft-deleted account', async () => {
      mockPrisma.mfgLead.findFirst.mockResolvedValue(qualifiedLead);
      mockPrisma.account.findFirst.mockResolvedValue(null);
      await expect(
        service.convert('ld-1', { contactRole: 'Decision Maker', accountId: 'acc-deleted' }, managerUser),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.account.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ isDeleted: false }) }),
      );
    });

    it('creates the account inside the transaction (not before it), so a later failure never orphans it', async () => {
      mockPrisma.mfgLead.findFirst.mockResolvedValue(qualifiedLead);
      mockPrisma.account.findMany.mockResolvedValue([]);
      const txAccountCreate = jest.fn().mockResolvedValue({ id: 'acc-new' });
      const txContactCreate = jest.fn().mockResolvedValue({ id: 'ct-new' });
      const txOpportunityCreate = jest.fn().mockResolvedValue({ id: 'op-new' });
      const txMfgLeadUpdate = jest.fn().mockResolvedValue({ id: 'ld-1' });
      const txActivityUpdateMany = jest.fn().mockResolvedValue({ count: 2 });
      const tx = {
        account: { create: txAccountCreate },
        contact: { create: txContactCreate },
        opportunity: { create: txOpportunityCreate },
        mfgLead: { update: txMfgLeadUpdate },
        mfgActivity: { updateMany: txActivityUpdateMany },
      };
      mockPrisma.$transaction.mockImplementationOnce((cb: (tx: unknown) => unknown) => cb(tx));
      await service.convert(
        'ld-1',
        { contactRole: 'Decision Maker', account: { type: 'Prospect', industry: 'Steel & metals', territory: 'West' } },
        managerUser,
      );
      expect(txActivityUpdateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({ mfgLeadId: 'ld-1' }),
        data: { opportunityId: 'op-new', accountId: 'acc-new', contactId: 'ct-new' },
      });
      expect(mockPrisma.account.create).not.toHaveBeenCalled();
      expect(txAccountCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ name: 'Acme Pvt Ltd' }) }));
    });

    it('links an existing contact via payload.contactId instead of creating a new one', async () => {
      mockPrisma.mfgLead.findFirst.mockResolvedValue(qualifiedLead);
      mockPrisma.account.findFirst.mockResolvedValue({ id: 'acc-1' });
      mockPrisma.contact.findFirst.mockResolvedValue({ id: 'ct-existing' });
      mockPrisma.opportunity.create.mockResolvedValue({ id: 'op-new' });
      mockPrisma.mfgLead.update.mockResolvedValue({ id: 'ld-1' });
      const result = await service.convert(
        'ld-1',
        { contactRole: 'Decision Maker', accountId: 'acc-1', contactId: 'ct-existing' },
        managerUser,
      );
      expect(mockPrisma.contact.create).not.toHaveBeenCalled();
      expect(result).toEqual({ accountId: 'acc-1', contactId: 'ct-existing', opportunityId: 'op-new' });
    });

    it('rejects contactId when creating a brand-new account', async () => {
      mockPrisma.mfgLead.findFirst.mockResolvedValue(qualifiedLead);
      mockPrisma.account.findMany.mockResolvedValue([]);
      await expect(
        service.convert(
          'ld-1',
          {
            contactRole: 'Decision Maker',
            account: { type: 'Prospect', industry: 'Steel & metals', territory: 'West' },
            contactId: 'ct-existing',
          },
          managerUser,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an out-of-org or nonexistent contactId', async () => {
      mockPrisma.mfgLead.findFirst.mockResolvedValue(qualifiedLead);
      mockPrisma.account.findFirst.mockResolvedValue({ id: 'acc-1' });
      mockPrisma.contact.findFirst.mockResolvedValue(null);
      await expect(
        service.convert('ld-1', { contactRole: 'Decision Maker', accountId: 'acc-1', contactId: 'ct-missing' }, managerUser),
      ).rejects.toThrow(BadRequestException);
    });
  });

  it('Qualify is blocked until Budget, Authority, Need and Timeline are captured', async () => {
    mockPrisma.mfgLead.findFirst.mockResolvedValue({ id: 'LD-1', orgId: 'org-1', status: 'Contacted', qBudget: 'Approved', qAuth: null, qNeed: '', qTime: 'This year' });
    await expect(service.performAction('LD-1', 'Qualify', {}, directorUser)).rejects.toThrow(/Authority, Need/);
    expect(mockPrisma.mfgLead.update).not.toHaveBeenCalled();
  });

  it('create blocks a second lead with the same phone or email', async () => {
    mockPrisma.mfgLead.findFirst.mockResolvedValue({ id: 'abcdef12-0000', company: 'Shree Steel' });
    await expect(
      service.create({ company: 'X', contactName: 'Y', phone: '9876543210', email: 'B@Shree.in', product: 'Conveyor', source: 'Website' } as never, directorUser),
    ).rejects.toThrow(ConflictException);
    expect(mockPrisma.mfgLead.create).not.toHaveBeenCalled();
    expect(mockPrisma.mfgLead.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ orgId: 'org-1', OR: [{ phone: '9876543210' }, { email: { equals: 'b@shree.in', mode: 'insensitive' } }] }),
      }),
    );
  });

  it('create auto-assigns a manager lead to the Sales Executive with the fewest open leads, as Assigned', async () => {
    mockPrisma.user.findMany.mockResolvedValue([{ id: 'exec-1' }, { id: 'exec-2' }, { id: 'exec-3' }]);
    mockPrisma.mfgLead.groupBy.mockResolvedValue([
      { ownerId: 'exec-1', _count: { _all: 5 } },
      { ownerId: 'exec-3', _count: { _all: 1 } },
    ]);
    mockPrisma.mfgLead.create.mockResolvedValue({ id: 'LD-1', orgId: 'org-1' });
    await service.create({ company: 'X', contactName: 'Y', phone: '9000000001', product: 'Conveyor', source: 'Website' } as never, managerUser);
    expect(mockPrisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { orgId: 'org-1', mfgRole: 'SALES_EXECUTIVE', isActive: true } }));
    expect(mockPrisma.mfgLead.create).toHaveBeenCalledWith({ data: expect.objectContaining({ ownerId: 'exec-2', status: 'Assigned', orgId: 'org-1' }) });
  });

  it('create keeps the chosen owner, and a Sales Executive always owns their own lead', async () => {
    mockPrisma.mfgLead.create.mockResolvedValue({ id: 'LD-1', orgId: 'org-1' });
    await service.create({ company: 'X', contactName: 'Y', phone: '9000000002', product: 'Conveyor', source: 'Website', ownerId: 'exec-9' } as never, managerUser);
    expect(mockPrisma.mfgLead.create).toHaveBeenLastCalledWith({ data: expect.objectContaining({ ownerId: 'exec-9', status: 'New' }) });
    await service.create({ company: 'X', contactName: 'Y', phone: '9000000003', product: 'Conveyor', source: 'Website', ownerId: 'exec-9' } as never, repUser);
    expect(mockPrisma.mfgLead.create).toHaveBeenLastCalledWith({ data: expect.objectContaining({ ownerId: 'rep-1', status: 'New' }) });
    expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
  });

  it('create falls back to the caller when the org has no Sales Executive', async () => {
    mockPrisma.mfgLead.create.mockResolvedValue({ id: 'LD-1', orgId: 'org-1' });
    await service.create({ company: 'X', contactName: 'Y', phone: '9000000004', product: 'Conveyor', source: 'Website' } as never, managerUser);
    expect(mockPrisma.mfgLead.create).toHaveBeenCalledWith({ data: expect.objectContaining({ ownerId: 'mgr-1', status: 'New' }) });
  });

  it('the default list hides Disqualified and Converted leads, but a status filter shows them', async () => {
    mockPrisma.mfgLead.count.mockResolvedValue(0);
    mockPrisma.mfgLead.findMany.mockResolvedValue([]);
    await service.findAll({ page: 1, limit: 20 }, directorUser);
    expect(mockPrisma.mfgLead.findMany.mock.calls[0][0].where.status).toEqual({ notIn: ['Disqualified', 'Converted'] });
    await service.findAll({ page: 1, limit: 20, status: ['Disqualified'] }, directorUser);
    const { where } = mockPrisma.mfgLead.findMany.mock.calls[1][0];
    expect(where.status).toBeUndefined();
    expect(where.AND).toEqual([{ status: { in: ['Disqualified'] } }]);
  });
  describe('nurturing triggers', () => {
    it('enrols a new lead in mfg_lead_created sequences', async () => {
      mockPrisma.mfgLead.findFirst.mockResolvedValue(null);
      mockPrisma.mfgLead.create.mockResolvedValue({ id: 'l-9', orgId: 'org-1', source: 'Website', value: null });
      await service.create({ company: 'A', contactName: 'B', phone: '9', product: 'Conveyor', source: 'Website' } as any, directorUser);
      expect(mockNurturing.enroll).toHaveBeenCalledWith('org-1', 'mfg_lead_created', 'MfgLead', 'l-9');
    });

    it('enrols a lead moved to Nurture in mfg_lead_nurture sequences', async () => {
      mockPrisma.mfgLead.findFirst.mockResolvedValue({ id: 'l-1', orgId: 'org-1', status: 'Contacted' });
      mockPrisma.mfgLead.update.mockResolvedValue({ id: 'l-1', orgId: 'org-1' });
      await service.performAction('l-1', 'Move to nurture', undefined, directorUser);
      expect(mockNurturing.enroll).toHaveBeenCalledWith('org-1', 'mfg_lead_nurture', 'MfgLead', 'l-1');
    });
  });

  describe('merge duplicates', () => {
    const duplicate = { id: 'dup', orgId: 'org-1', company: 'Acme', status: 'Contacted', email: 'a@acme.in', city: 'Pune', value: 500, designation: null };
    const keep = { id: 'keep', orgId: 'org-1', company: 'Acme Ltd', status: 'New', email: null, city: 'Mumbai', value: null, designation: null };

    it('moves history to the kept lead, fills only its gaps, and retires the duplicate', async () => {
      mockPrisma.mfgLead.findFirst.mockResolvedValueOnce(duplicate).mockResolvedValueOnce(keep);
      mockPrisma.mfgLead.update.mockResolvedValue({ id: 'keep' });
      mockPrisma.$transaction.mockImplementationOnce((operations: Promise<unknown>[]) => Promise.all(operations));
      const result = await service.performAction('dup', 'Merge into another lead', { into: 'keep' }, directorUser);
      expect(mockPrisma.mfgActivity.updateMany).toHaveBeenCalledWith({ where: { mfgLeadId: 'dup', orgId: 'org-1' }, data: { mfgLeadId: 'keep' } });
      expect(mockPrisma.mfgLead.update).toHaveBeenCalledWith({ where: { id: 'keep' }, data: { email: 'a@acme.in', value: 500 } });
      expect(mockPrisma.mfgLead.update).toHaveBeenCalledWith({ where: { id: 'dup' }, data: expect.objectContaining({ status: 'Disqualified', disqualifyReason: expect.stringContaining('Merged into Acme Ltd') }) });
      expect(mockPrisma.mfgLead.update).not.toHaveBeenCalledWith({ where: { id: 'dup' }, data: expect.objectContaining({ isDeleted: true }) });
      expect(mockNurturing.endEnrollments).toHaveBeenCalledWith('org-1', 'MfgLead', 'dup');
      expect(result).toEqual({ id: 'keep' });
    });

    it('refuses to merge a lead into itself or without a target', async () => {
      await expect(service.performAction('dup', 'Merge into another lead', { into: 'dup' }, directorUser)).rejects.toThrow(/different lead/);
      await expect(service.performAction('dup', 'Merge into another lead', {}, directorUser)).rejects.toThrow(/'into'/);
    });

    it('refuses to merge a converted lead', async () => {
      mockPrisma.mfgLead.findFirst.mockResolvedValueOnce({ ...duplicate, status: 'Converted' }).mockResolvedValueOnce(keep);
      await expect(service.performAction('dup', 'Merge into another lead', { into: 'keep' }, directorUser)).rejects.toThrow(/open leads/);
    });
  });

  describe('importLeads (CSV)', () => {
    const good = { company: 'Acme', contactName: 'Meera', phone: '9822012345', product: 'weighbridge', source: 'website' };

    it('creates valid rows, counts duplicates, and reports bad rows by number', async () => {
      mockPrisma.mfgLead.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'x', company: 'Dup' });
      mockPrisma.mfgLead.create.mockResolvedValue({ id: 'l-1', orgId: 'org-1', source: 'Website', value: null });
      const result = await service.importLeads([good, { ...good, phone: '9000000000' }, { company: 'No phone', contactName: 'X', product: 'Conveyor' }], directorUser);
      expect(result.imported).toBe(1);
      expect(result.duplicates).toBe(1);
      expect(result.errors).toEqual([{ row: 3, reason: expect.stringContaining('phone') }]);
      expect(mockPrisma.mfgLead.create).toHaveBeenCalledWith({ data: expect.objectContaining({ orgId: 'org-1', product: 'Weighbridge', source: 'Website' }) });
    });

    it('rejects an unknown product with a readable reason', async () => {
      const result = await service.importLeads([{ ...good, product: 'Spaceship' }], directorUser);
      expect(result.imported).toBe(0);
      expect(result.errors[0]).toEqual({ row: 1, reason: expect.stringContaining('product') });
    });
  });

  describe('ingest (webhook)', () => {
    const payload = { external_id: 'WEB-1001', name: 'Meera Joshi', company: 'Acme Fabricators', phone: '+91 98220 12345', email: 'Meera@Acme.in', product: 'weighbridge', source: 'website' };

    it('returns the existing lead for a repeated external id, scoped to the org', async () => {
      mockPrisma.mfgLead.findFirst.mockResolvedValue({ id: 'lead-1' });
      const result = await service.ingest(payload, 'org-1');
      expect(result).toEqual({ duplicate: true, leadId: 'lead-1' });
      expect(mockPrisma.mfgLead.create).not.toHaveBeenCalled();
      expect(mockPrisma.mfgLead.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1', OR: expect.arrayContaining([{ externalId: 'WEB-1001' }]) }) }),
      );
    });

    it('creates a lead with normalised phone, product and source and starts the SLA timer', async () => {
      mockPrisma.mfgLead.findFirst.mockResolvedValue(null);
      mockPrisma.mfgLead.create.mockResolvedValue({ id: 'lead-2', source: 'Website', value: null });
      await service.ingest(payload, 'org-1');
      expect(mockPrisma.mfgLead.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          orgId: 'org-1', externalId: 'WEB-1001', contactName: 'Meera Joshi', company: 'Acme Fabricators',
          phone: '9822012345', email: 'meera@acme.in', product: 'Weighbridge', source: 'Website', status: 'New',
        }),
      });
      expect(mockSlaEngine.startTimer).toHaveBeenCalled();
    });

    it('rejects an unknown product and a missing phone', async () => {
      await expect(service.ingest({ ...payload, product: 'Teapot' }, 'org-1')).rejects.toThrow(BadRequestException);
      await expect(service.ingest({ ...payload, phone: '' }, 'org-1')).rejects.toThrow(BadRequestException);
    });
  });
});
