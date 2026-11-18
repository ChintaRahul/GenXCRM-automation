import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { SiteVisitsService } from './site-visits.service';
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
  siteVisit: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  account: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
  },
  opportunity: {
    findFirst: jest.fn(),
  },
};

const repUser: AuthUser = { id: 'rep-1', name: 'Rep', email: 'rep@test.com', role: Role.SALES_REP, teamId: 'team-1', orgId: 'org-1' };
const managerUser: AuthUser = { id: 'mgr-1', name: 'Mgr', email: 'mgr@test.com', role: Role.MANAGER, teamId: 'team-1', orgId: 'org-1' };
const directorUser: AuthUser = { id: 'dir-1', name: 'Dir', email: 'dir@test.com', role: Role.DIRECTOR, teamId: null, orgId: 'org-1' };

describe('SiteVisitsService', () => {
  let service: SiteVisitsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        SiteVisitsService,
        {
          provide: 'PrismaService',
          useValue: mockPrisma,
        },
        { provide: SlaEngineService, useValue: mockSlaEngine },
        { provide: PdfService, useValue: mockPdf },
      ],
    })
      .useMocker((token) => {
        if (token?.toString().includes('PrismaService')) return mockPrisma;
        return {};
      })
      .compile();

    service = module.get(SiteVisitsService);
  });

  describe('findAll', () => {
    it('filters by opportunityId and accountId when passed (for the Opportunity detail page\'s Visits tab)', async () => {
      mockPrisma.siteVisit.count.mockResolvedValue(0);
      mockPrisma.siteVisit.findMany.mockResolvedValue([]);
      await service.findAll({ page: 1, limit: 20, opportunityId: 'OP-1', accountId: 'A-1' }, repUser);
      expect(mockPrisma.siteVisit.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ opportunityId: 'OP-1', accountId: 'A-1' }),
        }),
      );
    });

    it('scopes findAll to ownerId for SALES_REP', async () => {
      mockPrisma.siteVisit.count.mockResolvedValue(0);
      mockPrisma.siteVisit.findMany.mockResolvedValue([]);
      await service.findAll({ page: 1, limit: 20 }, repUser);
      expect(mockPrisma.siteVisit.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ ownerId: 'rep-1', orgId: 'org-1' }),
        }),
      );
    });

    it('does not scope findAll to ownerId for MANAGER', async () => {
      mockPrisma.siteVisit.count.mockResolvedValue(0);
      mockPrisma.siteVisit.findMany.mockResolvedValue([]);
      await service.findAll({ page: 1, limit: 20 }, managerUser);
      expect(mockPrisma.siteVisit.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ orgId: 'org-1' }),
        }),
      );
      const call = mockPrisma.siteVisit.findMany.mock.calls[0];
      expect((call[0].where as Record<string, unknown>).ownerId).toBeUndefined();
    });

    it('does not scope findAll to ownerId for DIRECTOR', async () => {
      mockPrisma.siteVisit.count.mockResolvedValue(0);
      mockPrisma.siteVisit.findMany.mockResolvedValue([]);
      await service.findAll({ page: 1, limit: 20 }, directorUser);
      expect(mockPrisma.siteVisit.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ orgId: 'org-1' }),
        }),
      );
      const call = mockPrisma.siteVisit.findMany.mock.calls[0];
      expect((call[0].where as Record<string, unknown>).ownerId).toBeUndefined();
    });

    it('owner query param is ignored for SALES_REP', async () => {
      mockPrisma.siteVisit.count.mockResolvedValue(0);
      mockPrisma.siteVisit.findMany.mockResolvedValue([]);
      await service.findAll({ page: 1, limit: 20, ownerId: ['other-id'] }, repUser);
      const call = mockPrisma.siteVisit.findMany.mock.calls[0];
      expect((call[0].where as Record<string, unknown>).ownerId).toEqual('rep-1');
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException for a record outside the org', async () => {
      mockPrisma.siteVisit.findFirst.mockResolvedValue(null);
      await expect(service.findOne('visit-1', repUser)).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    beforeEach(() => {
      mockPrisma.account.findFirst.mockResolvedValue({ id: 'acc-1', orgId: 'org-1' });
      mockPrisma.opportunity.findFirst.mockResolvedValue({ id: 'opp-1', orgId: 'org-1' });
    });

    it('defaults ownerId to the SALES_REP caller when omitted', async () => {
      mockPrisma.siteVisit.create.mockResolvedValue({ id: 'visit-1', ownerId: 'rep-1' });
      await service.create(
        { title: 'Visit 1', accountId: 'acc-1', visitDate: '2099-01-01', objective: 'Inspection' },
        repUser,
      );
      expect(mockPrisma.siteVisit.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ ownerId: 'rep-1' }),
        }),
      );
    });

    it('converts visitDate to a Date instance', async () => {
      mockPrisma.siteVisit.create.mockResolvedValue({ id: 'visit-1' });
      await service.create(
        { title: 'Visit 1', accountId: 'acc-1', visitDate: '2099-01-01', objective: 'Inspection' },
        repUser,
      );
      const call = mockPrisma.siteVisit.create.mock.calls[0];
      expect((call[0].data as Record<string, unknown>).visitDate).toEqual(new Date('2099-01-01'));
    });

    it('rejects a visit date in the past', async () => {
      await expect(
        service.create({ title: 'Visit 1', accountId: 'acc-1', visitDate: '2020-01-01', objective: 'Inspection' }, repUser),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.siteVisit.create).not.toHaveBeenCalled();
    });

    it('rejects create with an accountId belonging to another org', async () => {
      mockPrisma.account.findFirst.mockResolvedValue(null);
      await expect(
        service.create({ title: 'Visit 1', accountId: 'other-org-acc', visitDate: '2099-01-01', objective: 'Inspection' }, repUser),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.siteVisit.create).not.toHaveBeenCalled();
    });

    it('rejects create with an opportunityId belonging to another org', async () => {
      mockPrisma.opportunity.findFirst.mockResolvedValue(null);
      await expect(
        service.create(
          { title: 'Visit 1', accountId: 'acc-1', opportunityId: 'other-org-opp', visitDate: '2099-01-01', objective: 'Inspection' } as never,
          repUser,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.siteVisit.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('update writes the given fields to the record', async () => {
      mockPrisma.siteVisit.findFirst.mockResolvedValue({ id: 'visit-1', orgId: 'org-1' });
      mockPrisma.siteVisit.update.mockResolvedValue({});
      await service.update('visit-1', { objective: 'Updated objective' } as never, directorUser);
      expect(mockPrisma.siteVisit.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'visit-1' }, data: expect.objectContaining({ objective: 'Updated objective' }) }),
      );
    });

    it('update converts visitDate to a Date instance when present', async () => {
      mockPrisma.siteVisit.findFirst.mockResolvedValue({ id: 'visit-1', orgId: 'org-1' });
      mockPrisma.siteVisit.update.mockResolvedValue({});
      await service.update('visit-1', { visitDate: '2099-11-01' } as never, directorUser);
      expect(mockPrisma.siteVisit.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ visitDate: new Date('2099-11-01') }) }),
      );
    });

    it('update converts nextActionDate to a Date instance when present', async () => {
      mockPrisma.siteVisit.findFirst.mockResolvedValue({ id: 'visit-1', orgId: 'org-1' });
      mockPrisma.siteVisit.update.mockResolvedValue({});
      await service.update('visit-1', { nextActionDate: '2099-11-01' } as never, directorUser);
      expect(mockPrisma.siteVisit.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ nextActionDate: new Date('2099-11-01') }) }),
      );
    });

    it('stops the SLA-08 "Site visit report submission" timer once recommendation is saved', async () => {
      mockPrisma.siteVisit.findFirst.mockResolvedValue({ id: 'visit-1', orgId: 'org-1' });
      mockPrisma.siteVisit.update.mockResolvedValue({ id: 'visit-1', orgId: 'org-1' });
      await service.update('visit-1', { recommendation: 'Install a new load cell' } as never, directorUser);
      expect(mockSlaEngine.stopTimer).toHaveBeenCalledWith('org-1', 'visits', 'SiteVisit', 'visit-1', 'Report submitted');
    });

    it('does not stop the SLA-08 timer for an update with no recommendation', async () => {
      mockPrisma.siteVisit.findFirst.mockResolvedValue({ id: 'visit-1', orgId: 'org-1' });
      mockPrisma.siteVisit.update.mockResolvedValue({ id: 'visit-1', orgId: 'org-1' });
      await service.update('visit-1', { objective: 'Updated objective' } as never, directorUser);
      expect(mockSlaEngine.stopTimer).not.toHaveBeenCalled();
    });
  });

  describe('performAction', () => {
    it('performAction "Confirm" transitions Planned -> Confirmed', async () => {
      const record = { id: 'visit-1', status: 'Planned' };
      mockPrisma.siteVisit.findFirst.mockResolvedValue(record);
      mockPrisma.siteVisit.update.mockResolvedValue({ ...record, status: 'Confirmed' });
      await service.performAction('visit-1', 'Confirm', undefined, repUser);
      expect(mockPrisma.siteVisit.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'Confirmed' }),
        }),
      );
    });

    it('performAction "Complete visit" requires the next payload key', async () => {
      mockPrisma.siteVisit.findFirst.mockResolvedValue({ id: 'visit-1', status: 'Planned' });
      await expect(service.performAction('visit-1', 'Complete visit', {}, repUser)).rejects.toThrow(BadRequestException);
    });

    it('performAction "Complete visit" rejects a numbers-only next action', async () => {
      mockPrisma.siteVisit.findFirst.mockResolvedValue({ id: 'visit-1', status: 'Planned' });
      await expect(service.performAction('visit-1', 'Complete visit', { next: '12345' }, repUser)).rejects.toThrow(BadRequestException);
      expect(mockPrisma.siteVisit.update).not.toHaveBeenCalled();
    });

    it('performAction "Complete visit" rejects from Cancelled', async () => {
      mockPrisma.siteVisit.findFirst.mockResolvedValue({ id: 'visit-1', status: 'Cancelled' });
      await expect(service.performAction('visit-1', 'Complete visit', { next: 'action' }, repUser)).rejects.toThrow(BadRequestException);
    });

    it('performAction "Reschedule" requires the date payload key', async () => {
      mockPrisma.siteVisit.findFirst.mockResolvedValue({ id: 'visit-1', status: 'Planned' });
      await expect(service.performAction('visit-1', 'Reschedule', {}, repUser)).rejects.toThrow(BadRequestException);
    });

    it('performAction "Complete visit" writes the next payload value into nextAction', async () => {
      mockPrisma.siteVisit.findFirst.mockResolvedValue({ id: 'visit-1', orgId: 'org-1', status: 'Confirmed' });
      mockPrisma.siteVisit.update.mockResolvedValue({});
      await service.performAction('visit-1', 'Complete visit', { next: 'Send proposal' }, directorUser);
      expect(mockPrisma.siteVisit.update).toHaveBeenCalledWith({
        where: { id: 'visit-1' },
        data: { status: 'Completed', nextAction: 'Send proposal' },
      });
    });

    it('performAction "Reschedule" writes the new visitDate from the date payload key', async () => {
      mockPrisma.siteVisit.findFirst.mockResolvedValue({ id: 'visit-1', orgId: 'org-1', status: 'Planned' });
      mockPrisma.siteVisit.update.mockResolvedValue({});
      await service.performAction('visit-1', 'Reschedule', { date: '2099-11-01' }, directorUser);
      expect(mockPrisma.siteVisit.update).toHaveBeenCalledWith({
        where: { id: 'visit-1' },
        data: { status: 'Rescheduled', visitDate: new Date('2099-11-01') },
      });
    });

    it('performAction throws BadRequestException for an unknown action (PDF download is now its own /pdf route, not a performAction case)', async () => {
      mockPrisma.siteVisit.findFirst.mockResolvedValue({ id: 'visit-1', orgId: 'org-1', status: 'Planned' });
      await expect(service.performAction('visit-1', 'Download report PDF', undefined, repUser)).rejects.toThrow(BadRequestException);
    });

    it('starts the SLA-08 "Site visit report submission" timer on "Complete visit"', async () => {
      mockPrisma.siteVisit.findFirst.mockResolvedValue({ id: 'visit-1', orgId: 'org-1', status: 'Confirmed' });
      mockPrisma.siteVisit.update.mockResolvedValue({ id: 'visit-1', orgId: 'org-1' });
      await service.performAction('visit-1', 'Complete visit', { next: 'Send proposal' }, directorUser);
      expect(mockSlaEngine.startTimer).toHaveBeenCalledWith('org-1', 'visits', 'SiteVisit', 'visit-1', 'Visit completed');
    });
  });

  describe('archive', () => {
    it('sets isDeleted true', async () => {
      mockPrisma.siteVisit.findFirst.mockResolvedValue({ id: 'visit-1' });
      mockPrisma.siteVisit.update.mockResolvedValue({ id: 'visit-1', isDeleted: true });
      await service.archive('visit-1', repUser);
      expect(mockPrisma.siteVisit.update).toHaveBeenCalledWith(expect.objectContaining({ data: { isDeleted: true } }));
    });
  });

  describe('buildPdf', () => {
    it('renders the report via PdfService', async () => {
      mockPrisma.siteVisit.findFirst.mockResolvedValue({
        id: 'visit-1', orgId: 'org-1', accountId: 'a-1', plant: 'Unit 2', visitDate: new Date('2099-11-01'),
        objective: 'Assess weighbridge fit', engineers: 'R. Kumar', existingSystem: 'Old mechanical scale',
        customerProblem: 'Inaccurate readings', measurements: null, observations: null,
        recommendation: 'Install WB-500', customerComments: null, nextAction: 'Send proposal', status: 'Completed',
      });
      mockPrisma.account.findUnique.mockResolvedValue({ name: 'Kaveri Steel' });
      const { filename, buffer } = await service.buildPdf('visit-1', repUser);
      expect(filename).toBe('Site-Visit-Report-visit-1.pdf');
      expect(buffer.toString('utf8')).toBe('pdf-bytes');
      expect(mockPdf.fieldBlock).toHaveBeenCalled();
    });
    it('refuses a report for a visit that is not Completed yet', async () => {
      mockPrisma.siteVisit.findFirst.mockResolvedValue({ id: 'visit-2', orgId: 'org-1', status: 'Planned' });
      await expect(service.buildPdf('visit-2', repUser)).rejects.toThrow(/once the visit is Completed/);
    });
  });

  it('Complete visit treats a next action of only spaces as missing, and stores it trimmed', async () => {
    mockPrisma.siteVisit.findFirst.mockResolvedValue({ id: 'v-1', orgId: 'org-1', status: 'Confirmed' });
    await expect(service.performAction('v-1', 'Complete visit', { next: '   ' }, directorUser)).rejects.toThrow(/'next' is required/);
    expect(mockPrisma.siteVisit.update).not.toHaveBeenCalled();
    mockPrisma.siteVisit.update.mockResolvedValue({ id: 'v-1', orgId: 'org-1' });
    await service.performAction('v-1', 'Complete visit', { next: '  Send proposal ' }, directorUser);
    expect(mockPrisma.siteVisit.update).toHaveBeenCalledWith({ where: { id: 'v-1' }, data: { status: 'Completed', nextAction: 'Send proposal' } });
  });
});
