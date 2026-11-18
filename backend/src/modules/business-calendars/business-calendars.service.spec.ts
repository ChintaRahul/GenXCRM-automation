import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { BusinessCalendarsService } from './business-calendars.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';

describe('BusinessCalendarsService', () => {
  let service: BusinessCalendarsService;
  let prisma: any;

  const salesRep: AuthUser = { id: 'u1', orgId: 'org-1', role: Role.SALES_REP } as AuthUser;
  const manager: AuthUser = { id: 'u2', orgId: 'org-1', role: Role.MANAGER } as AuthUser;

  beforeEach(async () => {
    prisma = {
      businessCalendar: { findMany: jest.fn(), count: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    };
    const module = await Test.createTestingModule({
      providers: [BusinessCalendarsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(BusinessCalendarsService);
  });

  describe('findAll', () => {
    it('scopes to orgId only for every role', async () => {
      prisma.businessCalendar.findMany.mockResolvedValue([]);
      prisma.businessCalendar.count.mockResolvedValue(0);
      await service.findAll({ page: 1, limit: 20 }, salesRep);
      const where = prisma.businessCalendar.findMany.mock.calls[0][0].where;
      expect(where).toEqual(expect.objectContaining({ orgId: 'org-1' }));
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when not found', async () => {
      prisma.businessCalendar.findFirst.mockResolvedValue(null);
      await expect(service.findOne('missing', manager)).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('creates with default timezone when omitted', async () => {
      prisma.businessCalendar.create.mockResolvedValue({ id: 'bc-1' });
      await service.create({ days: [{ day: 'Mon', isWorkingDay: true, start: '09:00', end: '18:00' }] } as any, manager);
      expect(prisma.businessCalendar.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ orgId: 'org-1', timezone: 'Asia/Kolkata' }) }),
      );
    });

    it('honors an explicit timezone', async () => {
      prisma.businessCalendar.create.mockResolvedValue({ id: 'bc-1' });
      await service.create({ timezone: 'UTC', days: [] } as any, manager);
      expect(prisma.businessCalendar.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ timezone: 'UTC' }) }),
      );
    });
  });

  describe('update', () => {
    it('merges plain fields including days as an array', async () => {
      prisma.businessCalendar.findFirst.mockResolvedValue({ id: 'bc-1', orgId: 'org-1' });
      prisma.businessCalendar.update.mockResolvedValue({ id: 'bc-1' });
      const newDays = [{ day: 'Sat', isWorkingDay: false, start: '', end: '' }];
      await service.update('bc-1', { days: newDays } as any, manager);
      const data = prisma.businessCalendar.update.mock.calls[0][0].data;
      expect(Array.isArray(data.days)).toBe(true);
    });
  });
});
