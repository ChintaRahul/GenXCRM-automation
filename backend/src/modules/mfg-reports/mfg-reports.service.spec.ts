import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { MfgReportsService } from './mfg-reports.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PdfService } from '../pdf/pdf.service';
import type { AuthUser } from '../../common/types/auth-user.type';

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

describe('MfgReportsService', () => {
  let service: MfgReportsService;
  let prisma: any;

  const salesRep: AuthUser = { id: 'u1', orgId: 'org-1', role: Role.SALES_REP } as AuthUser;
  const manager: AuthUser = { id: 'u2', orgId: 'org-1', role: Role.MANAGER } as AuthUser;

  beforeEach(async () => {
    prisma = {
      report: { findMany: jest.fn(), count: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
      reportSchedule: { findMany: jest.fn() },
      rolePermission: { findFirst: jest.fn() },
      mfgLead: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
    };
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        MfgReportsService,
        { provide: PrismaService, useValue: prisma },
        { provide: PdfService, useValue: mockPdf },
      ],
    }).compile();
    service = module.get(MfgReportsService);
  });

  describe('findAll', () => {
    it('scopes to ownerId for SALES_REP', async () => {
      prisma.report.findMany.mockResolvedValue([]);
      prisma.report.count.mockResolvedValue(0);
      await service.findAll({ page: 1, limit: 20 }, salesRep);
      expect(prisma.report.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1', ownerId: 'u1' }) }),
      );
    });

    it('follows the role matrix: a Sales-Rep-level Accounts user with ALL access sees every report', async () => {
      prisma.rolePermission.findFirst.mockResolvedValue({ recordAccess: 'ALL' });
      prisma.report.findMany.mockResolvedValue([]);
      prisma.report.count.mockResolvedValue(0);
      await service.findAll({ page: 1, limit: 20 }, { ...salesRep, mfgRole: 'ACCOUNTS' } as AuthUser);
      const where = prisma.report.findMany.mock.calls[0][0].where;
      expect(where).toEqual(expect.objectContaining({ orgId: 'org-1' }));
      expect(where.ownerId).toBeUndefined();
    });

    it('follows the role matrix: OWN access keeps a rep to their own reports', async () => {
      prisma.rolePermission.findFirst.mockResolvedValue({ recordAccess: 'OWN' });
      prisma.report.findMany.mockResolvedValue([]);
      prisma.report.count.mockResolvedValue(0);
      await service.findAll({ page: 1, limit: 20 }, { ...salesRep, mfgRole: 'SALES_EXECUTIVE' } as AuthUser);
      expect(prisma.report.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1', ownerId: 'u1' }) }),
      );
    });

    it('scopes to orgId only for MANAGER', async () => {
      prisma.report.findMany.mockResolvedValue([]);
      prisma.report.count.mockResolvedValue(0);
      await service.findAll({ page: 1, limit: 20 }, manager);
      const where = prisma.report.findMany.mock.calls[0][0].where;
      expect(where).toEqual(expect.objectContaining({ orgId: 'org-1' }));
      expect(where.ownerId).toBeUndefined();
    });
  });

  describe('create', () => {
    it('creates with default scheduleFrequency and format', async () => {
      prisma.report.create.mockResolvedValue({ id: 'r-1' });
      await service.create({ name: 'Pipeline snapshot', category: 'Pipeline' } as any, manager);
      expect(prisma.report.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ orgId: 'org-1', scheduleFrequency: 'Not scheduled', format: 'Excel' }) }),
      );
    });

    it('forces ownerId to caller.id for SALES_REP', async () => {
      prisma.report.create.mockResolvedValue({ id: 'r-1' });
      await service.create({ name: 'My leads', category: 'Leads', ownerId: 'someone-else' } as any, salesRep);
      expect(prisma.report.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ ownerId: 'u1' }) }),
      );
    });
  });

  describe('update', () => {
    it('merges plain fields', async () => {
      prisma.report.findFirst.mockResolvedValue({ id: 'r-1', orgId: 'org-1' });
      prisma.report.update.mockResolvedValue({ id: 'r-1' });
      await service.update('r-1', { scheduleFrequency: 'Weekly' } as any, manager);
      expect(prisma.report.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ scheduleFrequency: 'Weekly' }) }),
      );
    });
  });

  describe('performAction', () => {
    // Export Excel/PDF are no longer performAction special cases — they're real file downloads
    // via the module framework's dedicated /csv and /pdf routes (see buildCsv/buildPdf below).
    it('throws BadRequestException for an unknown action', async () => {
      prisma.report.findFirst.mockResolvedValue({ id: 'r-1', orgId: 'org-1' });
      await expect(service.performAction('r-1', 'Bogus', undefined, manager)).rejects.toThrow(BadRequestException);
    });
  });

  describe('getDataTable', () => {
    it('reads the record first, then dispatches to the builder matching its name', async () => {
      prisma.report.findFirst.mockResolvedValue({ id: 'r-1', orgId: 'org-1', name: 'Lead-to-opportunity conversion' });
      prisma.mfgLead.count.mockResolvedValueOnce(10).mockResolvedValueOnce(4);
      const result = await service.getDataTable('r-1', manager);
      expect(prisma.report.findFirst).toHaveBeenCalled();
      expect(result.rows).toContainEqual({ metric: 'Conversion rate %', value: 40 });
    });

    it('returns a "not yet implemented" placeholder table instead of throwing for an unmatched report name', async () => {
      prisma.report.findFirst.mockResolvedValue({ id: 'r-1', orgId: 'org-1', name: 'Some report with no builder yet' });
      const result = await service.getDataTable('r-1', manager);
      expect(result.rows[0].note).toContain('Some report with no builder yet');
      expect(result.rows[0].note).toContain('not yet implemented');
    });

    it('throws NotFoundException for a report outside the org (via findOne)', async () => {
      prisma.report.findFirst.mockResolvedValue(null);
      await expect(service.getDataTable('r-1', manager)).rejects.toThrow('not found');
    });
  });

  describe('buildCsv', () => {
    it('renders the data table as CSV and stamps lastRunAt', async () => {
      prisma.report.findFirst.mockResolvedValue({ id: 'r-1', orgId: 'org-1', name: 'Lead-to-opportunity conversion' });
      prisma.mfgLead.count.mockResolvedValueOnce(10).mockResolvedValueOnce(4);
      const { filename, buffer } = await service.buildCsv('r-1', manager);
      expect(filename).toBe('Lead-to-opportunity-conversion.csv');
      const csv = buffer.toString('utf8');
      expect(csv).toContain('Metric,Value');
      expect(csv).toContain('Conversion rate %,40');
      expect(prisma.report.update).toHaveBeenCalledWith({ where: { id: 'r-1' }, data: { lastRunAt: expect.any(Date) } });
    });

    it('quotes a CSV field containing a comma', async () => {
      prisma.report.findFirst.mockResolvedValue({ id: 'r-1', orgId: 'org-1', name: 'Pipeline, Weighted' });
      const { buffer } = await service.buildCsv('r-1', manager);
      expect(buffer.toString('utf8')).toContain('"\'Pipeline, Weighted\' data generation is not yet implemented."');
    });
  });

  describe('buildPdf', () => {
    it('renders via PdfService and stamps lastRunAt', async () => {
      prisma.report.findFirst.mockResolvedValue({ id: 'r-1', orgId: 'org-1', name: 'Lead-to-opportunity conversion' });
      prisma.mfgLead.count.mockResolvedValueOnce(10).mockResolvedValueOnce(4);
      const { filename, buffer } = await service.buildPdf('r-1', manager);
      expect(filename).toBe('Lead-to-opportunity-conversion.pdf');
      expect(buffer.toString('utf8')).toBe('pdf-bytes');
      expect(mockPdf.table).toHaveBeenCalled();
      expect(prisma.report.update).toHaveBeenCalledWith({ where: { id: 'r-1' }, data: { lastRunAt: expect.any(Date) } });
    });
  });

  describe('getScheduleEvents', () => {
    it('resolves the parent through the org-scoped findOne before querying ReportSchedule', async () => {
      prisma.report.findFirst.mockResolvedValue({ id: 'r-1', orgId: 'org-1' });
      prisma.reportSchedule.findMany.mockResolvedValue([]);
      await service.getScheduleEvents('r-1', manager);
      expect(prisma.report.findFirst).toHaveBeenCalled();
      expect(prisma.reportSchedule.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { reportId: 'r-1' } }),
      );
    });

    it('returns an empty array when no ReportSchedule rows exist yet', async () => {
      prisma.report.findFirst.mockResolvedValue({ id: 'r-1', orgId: 'org-1' });
      prisma.reportSchedule.findMany.mockResolvedValue([]);
      const events = await service.getScheduleEvents('r-1', manager);
      expect(events).toEqual([]);
    });
  });
});
