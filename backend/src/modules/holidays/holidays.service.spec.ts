import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { HolidaysService } from './holidays.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';

describe('HolidaysService', () => {
  let service: HolidaysService;
  let prisma: any;

  const salesRep: AuthUser = { id: 'u1', orgId: 'org-1', role: Role.SALES_REP } as AuthUser;
  const manager: AuthUser = { id: 'u2', orgId: 'org-1', role: Role.MANAGER } as AuthUser;

  beforeEach(async () => {
    prisma = {
      holiday: { findMany: jest.fn(), count: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    };
    const module = await Test.createTestingModule({
      providers: [HolidaysService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(HolidaysService);
  });

  describe('findAll', () => {
    it('scopes to orgId only for every role', async () => {
      prisma.holiday.findMany.mockResolvedValue([]);
      prisma.holiday.count.mockResolvedValue(0);
      await service.findAll({ page: 1, limit: 20 }, salesRep);
      const where = prisma.holiday.findMany.mock.calls[0][0].where;
      expect(where).toEqual(expect.objectContaining({ orgId: 'org-1' }));
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when not found', async () => {
      prisma.holiday.findFirst.mockResolvedValue(null);
      await expect(service.findOne('missing', manager)).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('creates and converts date', async () => {
      prisma.holiday.create.mockResolvedValue({ id: 'h-1' });
      await service.create({ date: '2026-10-02', name: 'Gandhi Jayanti' } as any, manager);
      expect(prisma.holiday.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ orgId: 'org-1', date: new Date('2026-10-02') }) }),
      );
    });
  });

  describe('update', () => {
    it('converts date when present', async () => {
      prisma.holiday.findFirst.mockResolvedValue({ id: 'h-1', orgId: 'org-1' });
      prisma.holiday.update.mockResolvedValue({ id: 'h-1' });
      await service.update('h-1', { date: '2026-12-25' } as any, manager);
      expect(prisma.holiday.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ date: new Date('2026-12-25') }) }),
      );
    });

    it('does not touch date when absent', async () => {
      prisma.holiday.findFirst.mockResolvedValue({ id: 'h-1', orgId: 'org-1' });
      prisma.holiday.update.mockResolvedValue({ id: 'h-1' });
      await service.update('h-1', { name: 'Renamed' } as any, manager);
      const data = prisma.holiday.update.mock.calls[0][0].data;
      expect(data.date).toBeUndefined();
    });
  });
});
