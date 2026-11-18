import { Test } from '@nestjs/testing';
import { BadRequestException, NotImplementedException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { InstalledAssetsService } from './installed-assets.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';

describe('InstalledAssetsService', () => {
  let service: InstalledAssetsService;
  let prisma: any;

  const salesRep: AuthUser = { id: 'u1', orgId: 'org-1', role: Role.SALES_REP } as AuthUser;
  const manager: AuthUser = { id: 'u2', orgId: 'org-1', role: Role.MANAGER } as AuthUser;

  beforeEach(async () => {
    prisma = {
      installedAsset: { findMany: jest.fn(), count: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
      account: { findFirst: jest.fn() },
      salesOrder: { findFirst: jest.fn() },
    };
    const module = await Test.createTestingModule({
      providers: [InstalledAssetsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(InstalledAssetsService);
  });

  describe('findAll', () => {
    it('filters by accountId and salesOrderId when passed (for the Account/Sales Order detail pages\' Assets tabs)', async () => {
      prisma.installedAsset.findMany.mockResolvedValue([]);
      prisma.installedAsset.count.mockResolvedValue(0);
      await service.findAll({ page: 1, limit: 20, accountId: 'A-1', salesOrderId: 'SO-1' }, salesRep);
      expect(prisma.installedAsset.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ accountId: 'A-1', salesOrderId: 'SO-1' }) }),
      );
    });

    it('scopes to orgId only for every role, including SALES_REP (InstalledAsset has no ownerId)', async () => {
      prisma.installedAsset.findMany.mockResolvedValue([]);
      prisma.installedAsset.count.mockResolvedValue(0);
      await service.findAll({ page: 1, limit: 20 }, salesRep);
      const where = prisma.installedAsset.findMany.mock.calls[0][0].where;
      expect(where).toEqual(expect.objectContaining({ orgId: 'org-1' }));
      expect(where.ownerId).toBeUndefined();
    });
  });

  describe('create', () => {
    const dto = { serial: 'CW600-26-0200', model: 'CW-600 checkweigher', accountId: 'a-1' };

    it('rejects an accountId from another org', async () => {
      prisma.account.findFirst.mockResolvedValue(null);
      await expect(service.create(dto as any, manager)).rejects.toThrow(BadRequestException);
    });

    it('rejects a salesOrderId from another org when present', async () => {
      prisma.account.findFirst.mockResolvedValue({ id: 'a-1' });
      prisma.salesOrder.findFirst.mockResolvedValue(null);
      await expect(service.create({ ...dto, salesOrderId: 'other-org-so' } as any, manager)).rejects.toThrow(BadRequestException);
    });

    it('creates with status Under warranty', async () => {
      prisma.account.findFirst.mockResolvedValue({ id: 'a-1' });
      prisma.installedAsset.create.mockResolvedValue({ id: 'as-1' });
      await service.create(dto as any, manager);
      expect(prisma.installedAsset.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ orgId: 'org-1', status: 'Under warranty' }) }),
      );
    });

    it('converts installedOn when present', async () => {
      prisma.account.findFirst.mockResolvedValue({ id: 'a-1' });
      prisma.installedAsset.create.mockResolvedValue({ id: 'as-1' });
      await service.create({ ...dto, installedOn: '2026-01-15' } as any, manager);
      expect(prisma.installedAsset.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ installedOn: new Date('2026-01-15') }) }),
      );
    });

    it('converts commissionedOn when present', async () => {
      prisma.account.findFirst.mockResolvedValue({ id: 'a-1' });
      prisma.installedAsset.create.mockResolvedValue({ id: 'as-1' });
      await service.create({ ...dto, commissionedOn: '2026-02-01' } as any, manager);
      expect(prisma.installedAsset.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ commissionedOn: new Date('2026-02-01') }) }),
      );
    });

    it('converts warrantyStart when present', async () => {
      prisma.account.findFirst.mockResolvedValue({ id: 'a-1' });
      prisma.installedAsset.create.mockResolvedValue({ id: 'as-1' });
      await service.create({ ...dto, warrantyStart: '2026-02-01' } as any, manager);
      expect(prisma.installedAsset.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ warrantyStart: new Date('2026-02-01') }) }),
      );
    });
  });

  describe('update', () => {
    it('rejects an accountId from another org when present', async () => {
      prisma.installedAsset.findFirst.mockResolvedValue({ id: 'as-1', orgId: 'org-1' });
      prisma.account.findFirst.mockResolvedValue(null);
      await expect(service.update('as-1', { accountId: 'other-org-acc' } as any, manager)).rejects.toThrow(BadRequestException);
    });

    it('rejects a salesOrderId from another org when present', async () => {
      prisma.installedAsset.findFirst.mockResolvedValue({ id: 'as-1', orgId: 'org-1' });
      prisma.salesOrder.findFirst.mockResolvedValue(null);
      await expect(service.update('as-1', { salesOrderId: 'other-org-so' } as any, manager)).rejects.toThrow(BadRequestException);
    });

    it('converts warrantyEnd when present', async () => {
      prisma.installedAsset.findFirst.mockResolvedValue({ id: 'as-1', orgId: 'org-1' });
      prisma.installedAsset.update.mockResolvedValue({ id: 'as-1' });
      await service.update('as-1', { warrantyEnd: '2027-07-11' } as any, manager);
      expect(prisma.installedAsset.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ warrantyEnd: new Date('2027-07-11') }) }),
      );
    });

    it('converts installedOn when present', async () => {
      prisma.installedAsset.findFirst.mockResolvedValue({ id: 'as-1', orgId: 'org-1' });
      prisma.installedAsset.update.mockResolvedValue({ id: 'as-1' });
      await service.update('as-1', { installedOn: '2026-03-01' } as any, manager);
      expect(prisma.installedAsset.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ installedOn: new Date('2026-03-01') }) }),
      );
    });

    it('converts commissionedOn when present', async () => {
      prisma.installedAsset.findFirst.mockResolvedValue({ id: 'as-1', orgId: 'org-1' });
      prisma.installedAsset.update.mockResolvedValue({ id: 'as-1' });
      await service.update('as-1', { commissionedOn: '2026-03-15' } as any, manager);
      expect(prisma.installedAsset.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ commissionedOn: new Date('2026-03-15') }) }),
      );
    });

    it('converts warrantyStart when present', async () => {
      prisma.installedAsset.findFirst.mockResolvedValue({ id: 'as-1', orgId: 'org-1' });
      prisma.installedAsset.update.mockResolvedValue({ id: 'as-1' });
      await service.update('as-1', { warrantyStart: '2026-04-01' } as any, manager);
      expect(prisma.installedAsset.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ warrantyStart: new Date('2026-04-01') }) }),
      );
    });

    it('does not touch warrantyEnd when absent', async () => {
      prisma.installedAsset.findFirst.mockResolvedValue({ id: 'as-1', orgId: 'org-1' });
      prisma.installedAsset.update.mockResolvedValue({ id: 'as-1' });
      await service.update('as-1', { location: 'Line 2' } as any, manager);
      const data = prisma.installedAsset.update.mock.calls[0][0].data;
      expect(data.warrantyEnd).toBeUndefined();
    });
  });

  describe('performAction', () => {
    it('throws NotImplementedException for Raise service ticket', async () => {
      await expect(service.performAction('as-1', 'Raise service ticket', undefined, manager)).rejects.toThrow(NotImplementedException);
    });

    it('throws NotImplementedException for Create AMC renewal', async () => {
      await expect(service.performAction('as-1', 'Create AMC renewal', undefined, manager)).rejects.toThrow(NotImplementedException);
    });

    it('sets the coverage status by hand', async () => {
      prisma.installedAsset.findFirst.mockResolvedValue({ id: 'as-1', orgId: 'org-1' });
      prisma.installedAsset.update.mockResolvedValue({ id: 'as-1', status: 'Decommissioned' });
      await service.performAction('as-1', 'Set coverage status', { status: 'Decommissioned' }, manager);
      expect(prisma.installedAsset.update).toHaveBeenCalledWith({ where: { id: 'as-1' }, data: { status: 'Decommissioned' } });
    });

    it('rejects a coverage status that is not one of the four', async () => {
      prisma.installedAsset.findFirst.mockResolvedValue({ id: 'as-1', orgId: 'org-1' });
      await expect(service.performAction('as-1', 'Set coverage status', { status: 'Sold' }, manager)).rejects.toThrow(BadRequestException);
      expect(prisma.installedAsset.update).not.toHaveBeenCalled();
    });

    it('throws BadRequestException for an unknown action', async () => {
      prisma.installedAsset.findFirst.mockResolvedValue({ id: 'as-1', orgId: 'org-1' });
      await expect(service.performAction('as-1', 'Bogus', undefined, manager)).rejects.toThrow(BadRequestException);
    });
  });
});
