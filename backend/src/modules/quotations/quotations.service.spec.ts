import { AutomationEngineService } from '../automation-rules/automation-engine.service';
import { MfgNurturingService } from '../nurturing/mfg-nurturing.service';
import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { QuotationsService } from './quotations.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SlaEngineService } from '../sla-timers/sla-engine.service';
import { PdfService } from '../pdf/pdf.service';
import type { AuthUser } from '../../common/types/auth-user.type';

const mockSlaEngine = {
  startTimer: jest.fn().mockResolvedValue(undefined),
  stopTimer: jest.fn().mockResolvedValue(undefined),
  getSlaState: jest.fn().mockResolvedValue(null),
};

const stubDoc = {
  fontSize: jest.fn().mockReturnThis(),
  font: jest.fn().mockReturnThis(),
  text: jest.fn().mockReturnThis(),
  moveDown: jest.fn().mockReturnThis(),
};
const mockPdf = {
  render: jest.fn().mockImplementation((draw: (doc: unknown) => void) => {
    draw(stubDoc);
    return Promise.resolve(Buffer.from('pdf-bytes'));
  }),
  fieldBlock: jest.fn(),
  table: jest.fn(),
};

const mockPrisma = {
  quotation: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn() },
  quotationLine: { deleteMany: jest.fn(), createMany: jest.fn(), findMany: jest.fn() },
  opportunity: { findFirst: jest.fn(), findUnique: jest.fn() },
  account: { findFirst: jest.fn(), findUnique: jest.fn() },
  product: { findFirst: jest.fn() },
  approvalRule: { findMany: jest.fn() },
  mfgActivity: { create: jest.fn() },
  documentTemplate: { findFirst: jest.fn().mockResolvedValue(null) },
  approval: { create: jest.fn() },
  rolePermission: { findFirst: jest.fn() },
  user: { findMany: jest.fn() },
  $transaction: jest.fn(
    (cb: unknown) => (typeof cb === 'function' ? (cb as (prisma: typeof mockPrisma) => Promise<unknown>)(mockPrisma) : Promise.all(cb as Promise<unknown>[])),
  ),
};

const repUser: AuthUser = { id: 'rep-1', name: 'Rep', email: 'rep@test.com', role: Role.SALES_REP, teamId: 'team-1', orgId: 'org-1' };
const managerUser: AuthUser = { id: 'mgr-1', name: 'Mgr', email: 'mgr@test.com', role: Role.MANAGER, teamId: 'team-1', orgId: 'org-1' };
const directorUser: AuthUser = { id: 'dir-1', name: 'Dir', email: 'dir@test.com', role: Role.DIRECTOR, teamId: null, orgId: 'org-1' };

const baseQuotation = {
  id: 'q-1',
  orgId: 'org-1',
  opportunityId: 'opp-1',
  accountId: 'acc-1',
  version: 1,
  parentId: null,
  quotationDate: new Date('2026-01-01T00:00:00Z'),
  validUntil: new Date('2026-02-01T00:00:00Z'),
  currency: 'INR',
  ownerId: 'rep-1',
  status: 'Draft',
  paymentTerms: '100% advance',
  deliveryTerms: null,
  deliveryTime: null,
  warranty: null,
  freight: null,
  installation: null,
  exclusions: null,
  termsAndConditions: null,
  isDeleted: false,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

const mockNurturing = { enroll: jest.fn().mockResolvedValue(undefined) };

const mockAutomation = { fire: jest.fn().mockResolvedValue(undefined) };

describe('QuotationsService', () => {
  let service: QuotationsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        QuotationsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SlaEngineService, useValue: mockSlaEngine },
        { provide: AutomationEngineService, useValue: mockAutomation },
        { provide: MfgNurturingService, useValue: mockNurturing },
        { provide: PdfService, useValue: mockPdf },
      ],
    }).compile();
    service = module.get(QuotationsService);
    mockPrisma.opportunity.findFirst.mockResolvedValue({ id: 'opp-1', orgId: 'org-1' });
    mockPrisma.account.findFirst.mockResolvedValue({ id: 'acc-1', orgId: 'org-1' });
    mockPrisma.product.findFirst.mockResolvedValue({ id: 'prod-1', orgId: 'org-1' });
  });

  it('filters by opportunityId and accountId when passed (for related tabs on Opportunities/Accounts)', async () => {
    mockPrisma.quotation.count.mockResolvedValue(0);
    mockPrisma.quotation.findMany.mockResolvedValue([]);
    await service.findAll({ page: 1, limit: 20, opportunityId: 'OP-1', accountId: 'A-1' }, repUser);
    expect(mockPrisma.quotation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ opportunityId: 'OP-1', accountId: 'A-1' }) }),
    );
  });

  it('scopes findAll to ownerId for SALES_REP', async () => {
    mockPrisma.quotation.count.mockResolvedValue(0);
    mockPrisma.quotation.findMany.mockResolvedValue([]);
    await service.findAll({ page: 1, limit: 20 }, repUser);
    expect(mockPrisma.quotation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1', ownerId: 'rep-1', isDeleted: false }) }),
    );
  });

  it('does not scope findAll to ownerId for MANAGER', async () => {
    mockPrisma.quotation.count.mockResolvedValue(0);
    mockPrisma.quotation.findMany.mockResolvedValue([]);
    await service.findAll({ page: 1, limit: 20 }, managerUser);
    const where = mockPrisma.quotation.findMany.mock.calls[0][0].where;
    expect(where.ownerId).toBeUndefined();
    expect(where.orgId).toBe('org-1');
  });

  it('does not scope findAll to ownerId for DIRECTOR', async () => {
    mockPrisma.quotation.count.mockResolvedValue(0);
    mockPrisma.quotation.findMany.mockResolvedValue([]);
    await service.findAll({ page: 1, limit: 20 }, directorUser);
    const where = mockPrisma.quotation.findMany.mock.calls[0][0].where;
    expect(where.ownerId).toBeUndefined();
  });

  it('scopes findAll to ownerId for an mfgRole with OWN record access', async () => {
    mockPrisma.rolePermission.findFirst.mockResolvedValue({ recordAccess: 'OWN' });
    mockPrisma.quotation.count.mockResolvedValue(0);
    mockPrisma.quotation.findMany.mockResolvedValue([]);
    await service.findAll({ page: 1, limit: 20 }, { ...directorUser, mfgRole: 'SALES_EXECUTIVE' });
    expect(mockPrisma.rolePermission.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orgId: 'org-1', role: 'SALES_EXECUTIVE', moduleKey: 'quotes', isDeleted: false } }),
    );
    expect(mockPrisma.quotation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ ownerId: 'dir-1' }) }),
    );
  });

  it('scopes findAll to the team for an mfgRole with TEAM record access', async () => {
    mockPrisma.rolePermission.findFirst.mockResolvedValue({ recordAccess: 'TEAM' });
    mockPrisma.user.findMany.mockResolvedValue([{ id: 'mgr-1' }, { id: 'rep-1' }]);
    mockPrisma.quotation.count.mockResolvedValue(0);
    mockPrisma.quotation.findMany.mockResolvedValue([]);
    await service.findAll({ page: 1, limit: 20 }, { ...managerUser, mfgRole: 'SALES_MANAGER' });
    expect(mockPrisma.quotation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ ownerId: { in: ['mgr-1', 'rep-1'] } }) }),
    );
  });

  it('does not scope findAll for an mfgRole with ALL record access', async () => {
    mockPrisma.rolePermission.findFirst.mockResolvedValue({ recordAccess: 'ALL' });
    mockPrisma.quotation.count.mockResolvedValue(0);
    mockPrisma.quotation.findMany.mockResolvedValue([]);
    await service.findAll({ page: 1, limit: 20 }, { ...repUser, mfgRole: 'SALES_HEAD' });
    const where = mockPrisma.quotation.findMany.mock.calls.at(-1)![0].where;
    expect(where.ownerId).toBeUndefined();
  });

  it('owner query param is ignored for SALES_REP', async () => {
    mockPrisma.quotation.count.mockResolvedValue(0);
    mockPrisma.quotation.findMany.mockResolvedValue([]);
    await service.findAll({ page: 1, limit: 20, ownerId: ['other-rep-id'] }, repUser);
    const where = mockPrisma.quotation.findMany.mock.calls[0][0].where;
    expect(where.ownerId).toBe('rep-1');
  });

  it('findOne adds a readable title from the version and account name', async () => {
    mockPrisma.quotation.findFirst.mockResolvedValue({ id: 'q-1', orgId: 'org-1', status: 'Draft', version: 2, account: { name: 'Shree Steel' } });
    mockPrisma.quotationLine.findMany.mockResolvedValue([]);
    const result = await service.findOne('q-1', directorUser);
    expect(result.title).toBe('Quotation v2 — Shree Steel');
    expect(result).not.toHaveProperty('account');
  });

  it('findOne returns the quotation with its line items', async () => {
    mockPrisma.quotation.findFirst.mockResolvedValue({ id: 'q-1', orgId: 'org-1', status: 'Draft' });
    mockPrisma.quotationLine.findMany.mockResolvedValue([{ id: 'l-1', quotationId: 'q-1', qty: 2, unitPrice: 100 }]);
    const result = await service.findOne('q-1', directorUser);
    expect(result.lines).toEqual([{ id: 'l-1', quotationId: 'q-1', qty: 2, unitPrice: 100 }]);
    expect(mockPrisma.quotationLine.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { quotationId: 'q-1' } }));
  });

  it('findOne throws NotFoundException for a record outside the org', async () => {
    mockPrisma.quotation.findFirst.mockResolvedValue(null);
    await expect(service.findOne('q-1', directorUser)).rejects.toThrow(NotFoundException);
  });

  it('create defaults ownerId to the SALES_REP caller when omitted, version to 1, and status to Draft', async () => {
    mockPrisma.quotation.create.mockResolvedValue(baseQuotation);
    const dto = {
      opportunityId: 'opp-1',
      accountId: 'acc-1',
      quotationDate: '2026-01-01',
      validUntil: '2026-02-01',
      paymentTerms: '100% advance',
    };
    await service.create(dto as never, repUser);
    expect(mockPrisma.quotation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ ownerId: 'rep-1', version: 1, status: 'Draft', orgId: 'org-1' }),
    });
  });

  it('create converts quotationDate and validUntil to Date instances', async () => {
    mockPrisma.quotation.create.mockResolvedValue(baseQuotation);
    const dto = {
      opportunityId: 'opp-1',
      accountId: 'acc-1',
      quotationDate: '2026-01-01',
      validUntil: '2026-02-01',
      paymentTerms: '100% advance',
    };
    await service.create(dto as never, directorUser);
    expect(mockPrisma.quotation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ quotationDate: expect.any(Date), validUntil: expect.any(Date) }),
    });
  });

  it('create stamps the number from the org Quotation document template onto the record', async () => {
    const created = { ...baseQuotation, id: 'q-new', quotationDate: new Date('2026-03-05'), createdAt: new Date('2026-03-05') };
    mockPrisma.quotation.create.mockResolvedValue(created);
    mockPrisma.quotation.count.mockResolvedValue(7);
    mockPrisma.documentTemplate.findFirst.mockResolvedValueOnce({ numberingPattern: 'QT-{YYYY}-{####}', description: null });
    mockPrisma.quotation.update.mockResolvedValue({ ...created, documentNo: 'QT-2026-0007' });
    const dto = { opportunityId: 'opp-1', accountId: 'acc-1', quotationDate: '2026-03-05', validUntil: '2026-04-05', paymentTerms: '100% advance' };
    const result = await service.create(dto as never, directorUser);
    expect(mockPrisma.quotation.update).toHaveBeenCalledWith({ where: { id: 'q-new' }, data: { documentNo: 'QT-2026-0007' } });
    expect(result).toMatchObject({ documentNo: 'QT-2026-0007' });
  });

  it('create understands the {SEQ} token in the template pattern', async () => {
    const created = { ...baseQuotation, id: 'q-new', quotationDate: new Date('2026-03-05'), createdAt: new Date('2026-03-05') };
    mockPrisma.quotation.create.mockResolvedValue(created);
    mockPrisma.quotation.count.mockResolvedValue(12);
    mockPrisma.documentTemplate.findFirst.mockResolvedValueOnce({ numberingPattern: 'QT-{YYYY}-{SEQ}', description: null });
    mockPrisma.quotation.update.mockResolvedValue(created);
    const dto = { opportunityId: 'opp-1', accountId: 'acc-1', quotationDate: '2026-03-05', validUntil: '2026-04-05', paymentTerms: '100% advance' };
    await service.create(dto as never, directorUser);
    expect(mockPrisma.quotation.update).toHaveBeenCalledWith({ where: { id: 'q-new' }, data: { documentNo: 'QT-2026-0012' } });
  });

  it('rejects create with an opportunityId belonging to another org', async () => {
    mockPrisma.opportunity.findFirst.mockResolvedValue(null);
    const dto = {
      opportunityId: 'other-org-opp',
      accountId: 'acc-1',
      quotationDate: '2026-01-01',
      validUntil: '2026-02-01',
      paymentTerms: '100% advance',
    };
    await expect(service.create(dto as never, directorUser)).rejects.toThrow(BadRequestException);
    expect(mockPrisma.quotation.create).not.toHaveBeenCalled();
  });

  it('rejects create with an accountId belonging to another org', async () => {
    mockPrisma.account.findFirst.mockResolvedValue(null);
    const dto = {
      opportunityId: 'opp-1',
      accountId: 'other-org-acc',
      quotationDate: '2026-01-01',
      validUntil: '2026-02-01',
      paymentTerms: '100% advance',
    };
    await expect(service.create(dto as never, directorUser)).rejects.toThrow(BadRequestException);
    expect(mockPrisma.quotation.create).not.toHaveBeenCalled();
  });

  it('rejects update with an accountId belonging to another org', async () => {
    mockPrisma.quotation.findFirst.mockResolvedValue(baseQuotation);
    mockPrisma.account.findFirst.mockResolvedValue(null);
    await expect(
      service.update('q-1', { accountId: 'other-org-acc' } as never, directorUser),
    ).rejects.toThrow(BadRequestException);
    expect(mockPrisma.quotation.update).not.toHaveBeenCalled();
  });

  it('rejects update with a line productId belonging to another org', async () => {
    mockPrisma.quotation.findFirst.mockResolvedValue(baseQuotation);
    mockPrisma.product.findFirst.mockResolvedValue(null);
    const lines = [{ productId: 'other-org-prod', qty: 1, unitPrice: 100 }];
    await expect(
      service.update('q-1', { lines } as never, directorUser),
    ).rejects.toThrow(BadRequestException);
    expect(mockPrisma.quotationLine.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.quotation.update).not.toHaveBeenCalled();
  });

  it('refuses any edit to a Revised quotation version', async () => {
    mockPrisma.quotation.findFirst.mockResolvedValue({ ...baseQuotation, status: 'Revised' });
    await expect(service.update('q-1', { warranty: '1 year' } as never, directorUser)).rejects.toThrow(/read-only/);
    expect(mockPrisma.quotation.update).not.toHaveBeenCalled();
  });

  it('update without a lines field does not touch QuotationLine', async () => {
    mockPrisma.quotation.findFirst.mockResolvedValue(baseQuotation);
    mockPrisma.quotation.update.mockResolvedValue({ ...baseQuotation, warranty: '1 year' });

    const result = await service.update('q-1', { warranty: '1 year' } as never, directorUser);

    expect(mockPrisma.quotationLine.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.quotationLine.createMany).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockPrisma.quotation.update).toHaveBeenCalledWith({
      where: { id: 'q-1' },
      data: expect.objectContaining({ warranty: '1 year' }),
    });
    expect(result).toEqual({ ...baseQuotation, warranty: '1 year' });
  });

  it('update with a lines field replaces all QuotationLine rows transactionally', async () => {
    mockPrisma.quotation.findFirst.mockResolvedValue(baseQuotation);
    mockPrisma.quotationLine.deleteMany.mockResolvedValue({ count: 1 });
    mockPrisma.quotationLine.createMany.mockResolvedValue({ count: 2 });
    const updatedQuotation = { ...baseQuotation, warranty: '2 years' };
    mockPrisma.quotation.update.mockResolvedValue(updatedQuotation);

    const lines = [
      { qty: 2, unitPrice: 100 },
      { qty: 1, unitPrice: 50 },
    ];
    const result = await service.update('q-1', { warranty: '2 years', lines } as never, directorUser);

    expect(mockPrisma.quotationLine.deleteMany).toHaveBeenCalledWith({ where: { quotationId: 'q-1' } });
    expect(mockPrisma.quotationLine.createMany).toHaveBeenCalledWith({
      data: [
        { qty: 2, unitPrice: 100, amount: 200, quotationId: 'q-1' },
        { qty: 1, unitPrice: 50, amount: 50, quotationId: 'q-1' },
      ],
    });
    expect(mockPrisma.$transaction).toHaveBeenCalled();
    expect(mockPrisma.quotation.update).toHaveBeenCalledWith({
      where: { id: 'q-1' },
      data: expect.objectContaining({ warranty: '2 years' }),
    });
    expect(result).toEqual(updatedQuotation);
  });

  it('update fills a missing line amount from qty, price and discount, and keeps one that was entered', async () => {
    mockPrisma.quotation.findFirst.mockResolvedValue(baseQuotation);
    mockPrisma.quotation.update.mockResolvedValue(baseQuotation);

    await service.update('q-1', { lines: [{ qty: 2, unitPrice: 1000000, discountPct: 12 }, { qty: 1, unitPrice: 100, amount: 90 }] } as never, directorUser);

    expect(mockPrisma.quotationLine.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ amount: 1760000 }),
        expect.objectContaining({ amount: 90 }),
      ],
    });
  });

  it('performAction "Mark sent" transitions Approved -> Sent', async () => {
    const approved = { ...baseQuotation, status: 'Approved' };
    const sent = { ...approved, status: 'Sent' };
    mockPrisma.quotation.findFirst.mockResolvedValue(approved);
    mockPrisma.quotation.update.mockResolvedValue(sent);

    const result = await service.performAction('q-1', 'Mark sent', undefined, directorUser);

    expect(mockPrisma.quotation.update).toHaveBeenCalledWith({ where: { id: 'q-1' }, data: { status: 'Sent' } });
    expect(result).toEqual(sent);
  });

  it('performAction "Mark sent" stops SLA-11 and starts SLA-12', async () => {
    const approved = { ...baseQuotation, status: 'Approved' };
    mockPrisma.quotation.findFirst.mockResolvedValue(approved);
    mockPrisma.quotation.update.mockResolvedValue({ ...approved, status: 'Sent' });
    await service.performAction('q-1', 'Mark sent', undefined, directorUser);
    expect(mockSlaEngine.stopTimer).toHaveBeenCalledWith('org-1', 'quotes', 'Quotation', 'q-1', 'Quotation sent');
    expect(mockSlaEngine.startTimer).toHaveBeenCalledWith('org-1', 'quotes', 'Quotation', 'q-1', 'Quotation sent');
  });

  it('performAction "Mark accepted" stops the SLA-12 timer', async () => {
    const sent = { ...baseQuotation, status: 'Sent' };
    mockPrisma.quotation.findFirst.mockResolvedValue(sent);
    mockPrisma.quotation.update.mockResolvedValue({ ...sent, status: 'Accepted' });
    await service.performAction('q-1', 'Mark accepted', undefined, directorUser);
    expect(mockSlaEngine.stopTimer).toHaveBeenCalledWith('org-1', 'quotes', 'Quotation', 'q-1', 'Customer response logged');
  });

  it('performAction "Mark accepted" also stops the SLA-13 timer', async () => {
    const sent = { ...baseQuotation, status: 'Sent' };
    mockPrisma.quotation.findFirst.mockResolvedValue(sent);
    mockPrisma.quotation.update.mockResolvedValue({ ...sent, status: 'Accepted' });
    await service.performAction('q-1', 'Mark accepted', undefined, directorUser);
    expect(mockSlaEngine.stopTimer).toHaveBeenCalledWith('org-1', 'quotes', 'Quotation', 'q-1', 'Revised / accepted');
  });

  it('performAction "Mark sent" books a 3-day Quotation follow-up activity for the owner', async () => {
    const approved = { ...baseQuotation, status: 'Approved' };
    mockPrisma.quotation.findFirst.mockResolvedValue(approved);
    mockPrisma.quotation.update.mockResolvedValue({ ...approved, status: 'Sent' });
    await service.performAction('q-1', 'Mark sent', undefined, directorUser);
    expect(mockPrisma.mfgActivity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ orgId: 'org-1', type: 'Quotation follow-up', opportunityId: approved.opportunityId, ownerId: approved.ownerId, status: 'Open' }),
    });
  });

  it('performAction "Mark sent" enrols the quotation in quotation_sent sequences', async () => {
    const approved = { ...baseQuotation, status: 'Approved' };
    mockPrisma.quotation.findFirst.mockResolvedValue(approved);
    mockPrisma.quotation.update.mockResolvedValue({ ...approved, status: 'Sent' });
    await service.performAction('q-1', 'Mark sent', undefined, directorUser);
    expect(mockNurturing.enroll).toHaveBeenCalledWith('org-1', 'quotation_sent', 'Quotation', 'q-1');
  });

  it('performAction "Mark sent" fires the Quotation sent automation with the quotation value', async () => {
    const approved = { ...baseQuotation, status: 'Approved' };
    mockPrisma.quotation.findFirst.mockResolvedValue(approved);
    mockPrisma.quotation.update.mockResolvedValue({ ...approved, status: 'Sent' });
    mockPrisma.quotationLine.findMany.mockResolvedValue([{ amount: 950000, qty: 2, unitPrice: 500000 }]);
    await service.performAction('q-1', 'Mark sent', undefined, directorUser);
    expect(mockAutomation.fire).toHaveBeenCalledWith('org-1', 'Quotation sent', expect.objectContaining({ link: '/quotations/q-1', value: 950000 }));
  });

  it('performAction "Mark sent" rejects from Draft', async () => {
    mockPrisma.quotation.findFirst.mockResolvedValue(baseQuotation);
    await expect(service.performAction('q-1', 'Mark sent', undefined, directorUser)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('performAction "Mark rejected" requires the rej payload key', async () => {
    const sent = { ...baseQuotation, status: 'Sent' };
    mockPrisma.quotation.findFirst.mockResolvedValue(sent);
    await expect(service.performAction('q-1', 'Mark rejected', {}, directorUser)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('performAction "Approve" transitions Approval pending -> Approved', async () => {
    const pending = { ...baseQuotation, status: 'Approval pending' };
    mockPrisma.quotation.findFirst.mockResolvedValue(pending);
    mockPrisma.quotation.update.mockResolvedValue({ ...pending, status: 'Approved' });
    const result = await service.performAction('q-1', 'Approve', undefined, directorUser);
    expect(mockPrisma.quotation.update).toHaveBeenCalledWith({ where: { id: 'q-1' }, data: { status: 'Approved' } });
    expect(result).toEqual({ ...pending, status: 'Approved' });
  });

  it('performAction "Approve" starts the SLA-11 "Quotation issue" timer', async () => {
    const pending = { ...baseQuotation, status: 'Approval pending' };
    mockPrisma.quotation.findFirst.mockResolvedValue(pending);
    mockPrisma.quotation.update.mockResolvedValue({ ...pending, status: 'Approved' });
    await service.performAction('q-1', 'Approve', undefined, directorUser);
    expect(mockSlaEngine.startTimer).toHaveBeenCalledWith('org-1', 'quotes', 'Quotation', 'q-1', 'Costing approved');
  });

  it('performAction "Reject" from Approval pending sends the quotation back to Draft (not Rejected) and requires rej', async () => {
    const pending = { ...baseQuotation, status: 'Approval pending' };
    mockPrisma.quotation.findFirst.mockResolvedValue(pending);
    await expect(service.performAction('q-1', 'Reject', {}, directorUser)).rejects.toThrow(BadRequestException);
    mockPrisma.quotation.update.mockResolvedValue({ ...pending, status: 'Draft' });
    const result = await service.performAction('q-1', 'Reject', { rej: 'Margin too thin' }, directorUser);
    expect(mockPrisma.quotation.update).toHaveBeenCalledWith({ where: { id: 'q-1' }, data: { status: 'Draft' } });
    expect(result).toEqual({ ...pending, status: 'Draft' });
  });

  describe('update — Draft-only lines guard', () => {
    it('rejects editing lines on a non-Draft quotation', async () => {
      mockPrisma.quotation.findFirst.mockResolvedValue({ id: 'qt-1', orgId: 'org-1', status: 'Sent' });
      await expect(
        service.update('qt-1', { lines: [{ qty: 1, unitPrice: 100, discountPct: 0 }] } as any, managerUser),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows editing lines while Draft', async () => {
      mockPrisma.quotation.findFirst.mockResolvedValue({ id: 'qt-1', orgId: 'org-1', status: 'Draft' });
      mockPrisma.quotation.update.mockResolvedValue({ id: 'qt-1' });
      await expect(
        service.update('qt-1', { lines: [{ qty: 1, unitPrice: 100, discountPct: 0 }] } as any, managerUser),
      ).resolves.toBeDefined();
    });

    it('allows non-lines updates regardless of status', async () => {
      mockPrisma.quotation.findFirst.mockResolvedValue({ id: 'qt-1', orgId: 'org-1', status: 'Sent' });
      mockPrisma.quotation.update.mockResolvedValue({ id: 'qt-1' });
      await expect(service.update('qt-1', { ownerId: 'u-2' } as any, managerUser)).resolves.toBeDefined();
    });

    it('rejects changing commercial terms once the quotation is issued', async () => {
      mockPrisma.quotation.findFirst.mockResolvedValue({ id: 'qt-1', orgId: 'org-1', status: 'Sent', warranty: '6 months' });
      await expect(service.update('qt-1', { warranty: '12 months' } as any, managerUser)).rejects.toThrow(/Revise/);
      expect(mockPrisma.quotation.update).not.toHaveBeenCalled();
    });

    it('allows re-saving unchanged commercial terms on an issued quotation', async () => {
      mockPrisma.quotation.findFirst.mockResolvedValue({ id: 'qt-1', orgId: 'org-1', status: 'Sent', warranty: '6 months', validUntil: new Date('2026-12-01') });
      mockPrisma.quotation.update.mockResolvedValue({ id: 'qt-1' });
      await expect(service.update('qt-1', { warranty: '6 months', validUntil: '2026-12-01' } as any, managerUser)).resolves.toBeDefined();
    });
  });

  describe('submitForApproval', () => {
    it('rejects submitting a non-Draft quotation', async () => {
      mockPrisma.quotation.findFirst.mockResolvedValue({ id: 'qt-1', orgId: 'org-1', status: 'Sent' });
      await expect(service.submitForApproval('qt-1', managerUser)).rejects.toThrow(BadRequestException);
    });

    it('auto-approves when no ApprovalRule matches the max line discount', async () => {
      mockPrisma.quotation.findFirst.mockResolvedValue({ id: 'qt-1', orgId: 'org-1', status: 'Draft' });
      mockPrisma.quotationLine.findMany.mockResolvedValue([{ discountPct: 3, unitPrice: 1000, productId: null, product: null }]);
      mockPrisma.approvalRule.findMany.mockResolvedValue([]);
      mockPrisma.quotation.update.mockResolvedValue({ id: 'qt-1', orgId: 'org-1', status: 'Approved' });
      const result = await service.submitForApproval('qt-1', managerUser);
      expect(mockPrisma.approval.create).not.toHaveBeenCalled();
      expect((result.warnings as string[])).toEqual([]);
      expect(mockSlaEngine.startTimer).toHaveBeenCalledWith('org-1', 'quotes', 'Quotation', 'qt-1', 'Costing approved');
    });

    it('does not start SLA-11 when the quotation instead goes to Approval pending', async () => {
      mockPrisma.quotation.findFirst.mockResolvedValue({ id: 'qt-1', orgId: 'org-1', status: 'Draft' });
      mockPrisma.quotationLine.findMany.mockResolvedValue([{ discountPct: 30, unitPrice: 1000, productId: null, product: null }]);
      mockPrisma.approvalRule.findMany.mockResolvedValue([{ id: 'rule-1', min: 10, max: 100, approverRole: 'SALES_HEAD' }]);
      mockPrisma.approval.create.mockResolvedValue({ id: 'ap-1', orgId: 'org-1', currentApprover: 'SALES_HEAD' });
      mockPrisma.quotation.update.mockResolvedValue({ id: 'qt-1', orgId: 'org-1', status: 'Approval pending' });
      await service.submitForApproval('qt-1', managerUser);
      expect(mockSlaEngine.startTimer).not.toHaveBeenCalledWith('org-1', 'quotes', 'Quotation', 'qt-1', 'Costing approved');
    });

    it('creates an Approval when the max line discount matches a rule', async () => {
      mockPrisma.quotation.findFirst.mockResolvedValue({ id: 'qt-1', orgId: 'org-1', status: 'Draft' });
      mockPrisma.quotationLine.findMany.mockResolvedValue([{ discountPct: 12, unitPrice: 1000, productId: null, product: null }]);
      mockPrisma.approvalRule.findMany.mockResolvedValue([{ id: 'ar-1', min: 10, max: 15, approverRole: 'Sales Head' }]);
      mockPrisma.approval.create.mockResolvedValue({ id: 'ap-1' });
      mockPrisma.quotation.update.mockResolvedValue({ id: 'qt-1', status: 'Approval pending' });
      await service.submitForApproval('qt-1', managerUser);
      expect(mockPrisma.approval.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ entityType: 'Quotation', type: 'Discount', matchedRule: 'ar-1' }) }),
      );
    });

    it('routes a discount exactly on a band edge (5%) to the lower band', async () => {
      mockPrisma.quotation.findFirst.mockResolvedValue({ id: 'qt-1', orgId: 'org-1', status: 'Draft' });
      mockPrisma.quotationLine.findMany.mockResolvedValue([{ discountPct: 5, unitPrice: 1000, productId: null, product: null }]);
      mockPrisma.approvalRule.findMany.mockResolvedValue([
        { id: 'ar-sp', min: 0, max: 5, approverRole: 'Salesperson' },
        { id: 'ar-sm', min: 5, max: 10, approverRole: 'Sales Manager' },
      ]);
      mockPrisma.approval.create.mockResolvedValue({ id: 'ap-1' });
      mockPrisma.quotation.update.mockResolvedValue({ id: 'qt-1', status: 'Approval pending' });
      await service.submitForApproval('qt-1', managerUser);
      expect(mockPrisma.approval.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ matchedRule: 'ar-sp' }) }),
      );
    });

    it('starts the SLA-14 "Approval turnaround" timer for the auto-created approval', async () => {
      mockPrisma.quotation.findFirst.mockResolvedValue({ id: 'qt-1', orgId: 'org-1', status: 'Draft' });
      mockPrisma.quotationLine.findMany.mockResolvedValue([{ discountPct: 12, unitPrice: 1000, productId: null, product: null }]);
      mockPrisma.approvalRule.findMany.mockResolvedValue([{ id: 'ar-1', min: 10, max: 15, approverRole: 'Sales Head' }]);
      mockPrisma.approval.create.mockResolvedValue({ id: 'ap-1', orgId: 'org-1', currentApprover: 'Sales Head' });
      mockPrisma.quotation.update.mockResolvedValue({ id: 'qt-1', status: 'Approval pending' });
      await service.submitForApproval('qt-1', managerUser);
      expect(mockSlaEngine.startTimer).toHaveBeenCalledWith('org-1', 'approvals', 'Approval', 'ap-1', 'Approval requested', 'Sales Head');
    });

    it('warns (but does not block) when a line net price is below the product minimum', async () => {
      mockPrisma.quotation.findFirst.mockResolvedValue({ id: 'qt-1', orgId: 'org-1', status: 'Draft' });
      mockPrisma.quotationLine.findMany.mockResolvedValue([
        { discountPct: 0, unitPrice: 100, productId: 'p-1', product: { sku: 'SKU-1', minPrice: 150 } },
      ]);
      mockPrisma.approvalRule.findMany.mockResolvedValue([]);
      mockPrisma.quotation.update.mockResolvedValue({ id: 'qt-1', status: 'Approved' });
      const result = await service.submitForApproval('qt-1', managerUser);
      expect((result.warnings as string[]).length).toBe(1);
      expect(mockPrisma.quotation.update).toHaveBeenCalledWith({ where: { id: 'qt-1' }, data: { status: 'Approved' } });
    });

    it('routes a discount below the lowest configured bracket to the lowest rule instead of auto-approving', async () => {
      mockPrisma.quotation.findFirst.mockResolvedValue({ id: 'qt-1', orgId: 'org-1', status: 'Draft' });
      mockPrisma.quotationLine.findMany.mockResolvedValue([{ discountPct: 2, unitPrice: 1000, productId: null, product: null }]);
      mockPrisma.approvalRule.findMany.mockResolvedValue([{ id: 'ar-low', min: 5, max: 10, approverRole: 'Sales Manager' }]);
      mockPrisma.approval.create.mockResolvedValue({ id: 'ap-1' });
      mockPrisma.quotation.update.mockResolvedValue({ id: 'qt-1', status: 'Approval pending' });
      await service.submitForApproval('qt-1', managerUser);
      expect(mockPrisma.approval.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ matchedRule: 'ar-low' }) }),
      );
    });

    it('routes a discount at/above the highest configured bracket to the highest rule instead of auto-approving', async () => {
      mockPrisma.quotation.findFirst.mockResolvedValue({ id: 'qt-1', orgId: 'org-1', status: 'Draft' });
      mockPrisma.quotationLine.findMany.mockResolvedValue([{ discountPct: 99, unitPrice: 1000, productId: null, product: null }]);
      mockPrisma.approvalRule.findMany.mockResolvedValue([{ id: 'ar-high', min: 5, max: 10, approverRole: 'Director' }]);
      mockPrisma.approval.create.mockResolvedValue({ id: 'ap-1' });
      mockPrisma.quotation.update.mockResolvedValue({ id: 'qt-1', status: 'Approval pending' });
      await service.submitForApproval('qt-1', managerUser);
      expect(mockPrisma.approval.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ matchedRule: 'ar-high' }) }),
      );
    });
  });

  describe('reviseNewVersion', () => {
    it('creates a new Draft quotation with version+1 and copies all lines', async () => {
      const parent = {
        id: 'qt-1', orgId: 'org-1', opportunityId: 'op-1', accountId: 'a-1', version: 1, quotationDate: new Date(),
        validUntil: new Date(), currency: 'INR', ownerId: 'u1', paymentTerms: '100% advance', status: 'Sent',
      };
      mockPrisma.quotation.findFirst.mockResolvedValue(parent);
      mockPrisma.quotationLine.findMany.mockResolvedValue([{ productId: 'p-1', description: 'Widget', qty: 2, unitPrice: 500, discountPct: 0, amount: 1000 }]);
      mockPrisma.quotation.create.mockResolvedValue({ id: 'qt-2', version: 2, parentId: 'qt-1' });
      mockPrisma.quotationLine.createMany.mockResolvedValue({ count: 1 });
      mockPrisma.quotation.update.mockResolvedValue({ id: 'qt-1', status: 'Revised' });
      const result = await service.reviseNewVersion('qt-1', managerUser);
      expect(mockPrisma.quotation.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ version: 2, parentId: 'qt-1', status: 'Draft' }) }),
      );
      expect(mockPrisma.quotationLine.createMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: [expect.objectContaining({ quotationId: 'qt-2', productId: 'p-1' })] }),
      );
      expect(mockPrisma.quotation.update).toHaveBeenCalledWith({ where: { id: 'qt-1' }, data: { status: 'Revised' } });
      expect(result).toEqual(expect.objectContaining({ id: 'qt-2' }));
      expect(mockSlaEngine.stopTimer).toHaveBeenCalledWith('org-1', 'quotes', 'Quotation', 'qt-1', 'Revised / accepted');
    });

    it('does not call createMany when the parent has no lines', async () => {
      const parent = { id: 'qt-1', orgId: 'org-1', opportunityId: 'op-1', accountId: 'a-1', version: 1, quotationDate: new Date(), validUntil: new Date(), currency: 'INR', ownerId: 'u1', status: 'Sent' };
      mockPrisma.quotation.findFirst.mockResolvedValue(parent);
      mockPrisma.quotationLine.findMany.mockResolvedValue([]);
      mockPrisma.quotation.create.mockResolvedValue({ id: 'qt-2' });
      mockPrisma.quotation.update.mockResolvedValue({ id: 'qt-1' });
      await service.reviseNewVersion('qt-1', managerUser);
      expect(mockPrisma.quotationLine.createMany).not.toHaveBeenCalled();
    });

    it('rejects revising a Draft quotation', async () => {
      const parent = { id: 'qt-1', orgId: 'org-1', opportunityId: 'op-1', accountId: 'a-1', version: 1, quotationDate: new Date(), validUntil: new Date(), currency: 'INR', ownerId: 'u1', status: 'Draft' };
      mockPrisma.quotation.findFirst.mockResolvedValue(parent);
      await expect(service.reviseNewVersion('qt-1', managerUser)).rejects.toThrow(BadRequestException);
      expect(mockPrisma.quotation.create).not.toHaveBeenCalled();
    });
  });

  it('archive sets isDeleted true', async () => {
    mockPrisma.quotation.findFirst.mockResolvedValue(baseQuotation);
    mockPrisma.quotation.update.mockResolvedValue({ ...baseQuotation, isDeleted: true });

    await service.archive('q-1', directorUser);

    expect(mockPrisma.quotation.update).toHaveBeenCalledWith({
      where: { id: 'q-1' },
      data: { isDeleted: true },
    });
  });

  it('getVersionEvents returns a single synthesized entry for the current quotation', async () => {
    mockPrisma.quotation.findFirst.mockResolvedValue(baseQuotation);

    const result = await service.getVersionEvents('q-1', directorUser);

    expect(result).toEqual([
      { id: 'q-1', at: baseQuotation.createdAt.toISOString(), label: 'V1 created' },
    ]);
  });

  describe('buildPdf with a document template', () => {
    it('prints the number from the template pattern and falls back to its terms text', async () => {
      mockPrisma.quotation.findFirst.mockResolvedValue({ ...baseQuotation, quotationDate: new Date('2026-10-05'), createdAt: new Date('2026-10-05'), termsAndConditions: null });
      mockPrisma.quotation.count.mockResolvedValue(7);
      mockPrisma.documentTemplate.findFirst.mockResolvedValueOnce({ numberingPattern: 'QT-{YY}{MM}-{####}', description: 'Standard terms apply.' });
      mockPrisma.account.findUnique.mockResolvedValue({ name: 'Kaveri Steel' });
      mockPrisma.opportunity.findUnique.mockResolvedValue({ title: 'Deal' });
      mockPrisma.quotationLine.findMany.mockResolvedValue([]);
      await service.buildPdf('q-1', directorUser);
      expect(stubDoc.text).toHaveBeenCalledWith('QT-2610-0007 · v1', { align: 'right' });
      expect(stubDoc.text).toHaveBeenCalledWith('Standard terms apply.');
    });
  });

  describe('buildPdf', () => {
    it('renders via PdfService using the account, opportunity, and line items', async () => {
      mockPrisma.quotation.findFirst.mockResolvedValue(baseQuotation);
      mockPrisma.account.findUnique.mockResolvedValue({ name: 'Kaveri Steel', billing: '1 MG Road', city: 'Bengaluru', state: 'Karnataka' });
      mockPrisma.opportunity.findUnique.mockResolvedValue({ title: 'Weighbridge deal' });
      mockPrisma.quotationLine.findMany.mockResolvedValue([
        { description: 'Weighbridge WB-500', qty: 2, unitPrice: 500000, discountPct: 5, amount: 950000, product: null },
      ]);
      const { filename, buffer } = await service.buildPdf('q-1', directorUser);
      expect(filename).toBe('Quotation-q-1-v1.pdf');
      expect(buffer.toString('utf8')).toBe('pdf-bytes');
      expect(mockPdf.table).toHaveBeenCalledWith(
        stubDoc,
        expect.any(Array),
        [['Weighbridge WB-500', '2', '5,00,000', '5%', '9,50,000']],
      );
    });
  });
});
