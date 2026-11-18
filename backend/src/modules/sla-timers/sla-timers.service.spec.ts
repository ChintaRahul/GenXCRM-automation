import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { SlaTimersService } from './sla-timers.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';

describe('SlaTimersService', () => {
  let service: SlaTimersService;
  let prisma: any;

  const salesRep: AuthUser = { id: 'u1', orgId: 'org-1', role: Role.SALES_REP } as AuthUser;
  const manager: AuthUser = { id: 'u2', orgId: 'org-1', role: Role.MANAGER } as AuthUser;

  beforeEach(async () => {
    prisma = {
      slaTimer: { findMany: jest.fn(), count: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
      slaPolicy: { findFirst: jest.fn() },
    };
    const module = await Test.createTestingModule({
      providers: [SlaTimersService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(SlaTimersService);
  });

  describe('findAll', () => {
    it('scopes to orgId only for every role', async () => {
      prisma.slaTimer.findMany.mockResolvedValue([]);
      prisma.slaTimer.count.mockResolvedValue(0);
      await service.findAll({ page: 1, limit: 20 }, salesRep);
      const where = prisma.slaTimer.findMany.mock.calls[0][0].where;
      expect(where).toEqual(expect.objectContaining({ orgId: 'org-1' }));
      expect(where.ownerId).toBeUndefined();
    });
  });

  describe('create', () => {
    const dto = { slaPolicyId: 'sp-1', entityType: 'Opportunity', entityId: 'op-1' };

    it('rejects a slaPolicyId from another org', async () => {
      prisma.slaPolicy.findFirst.mockResolvedValue(null);
      await expect(service.create(dto as any, manager)).rejects.toThrow(BadRequestException);
    });

    it('creates with status Not started', async () => {
      prisma.slaPolicy.findFirst.mockResolvedValue({ id: 'sp-1' });
      prisma.slaTimer.create.mockResolvedValue({ id: 'st-1' });
      await service.create(dto as any, manager);
      expect(prisma.slaTimer.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ orgId: 'org-1', status: 'Not started' }) }),
      );
    });
  });

  describe('update', () => {
    it('rejects a slaPolicyId from another org when present', async () => {
      prisma.slaTimer.findFirst.mockResolvedValue({ id: 'st-1', orgId: 'org-1' });
      prisma.slaPolicy.findFirst.mockResolvedValue(null);
      await expect(service.update('st-1', { slaPolicyId: 'other-org-sp' } as any, manager)).rejects.toThrow(BadRequestException);
    });

    it('merges plain fields', async () => {
      prisma.slaTimer.findFirst.mockResolvedValue({ id: 'st-1', orgId: 'org-1' });
      prisma.slaTimer.update.mockResolvedValue({ id: 'st-1' });
      await service.update('st-1', { entityId: 'op-2' } as any, manager);
      expect(prisma.slaTimer.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ entityId: 'op-2' }) }),
      );
    });
  });

  describe('performAction', () => {
    it('Start sets startedAt and status On track', async () => {
      prisma.slaTimer.findFirst.mockResolvedValue({ id: 'st-1', orgId: 'org-1', status: 'Not started' });
      prisma.slaTimer.update.mockResolvedValue({ id: 'st-1' });
      await service.performAction('st-1', 'Start', undefined, manager);
      expect(prisma.slaTimer.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'st-1' }, data: expect.objectContaining({ status: 'On track' }) }),
      );
    });

    it('Stop sets stoppedAt and status Met', async () => {
      prisma.slaTimer.findFirst.mockResolvedValue({ id: 'st-1', orgId: 'org-1', status: 'On track' });
      prisma.slaTimer.update.mockResolvedValue({ id: 'st-1' });
      await service.performAction('st-1', 'Stop', undefined, manager);
      expect(prisma.slaTimer.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'st-1' }, data: expect.objectContaining({ status: 'Met' }) }),
      );
    });

    it('Pause sets pausedAt', async () => {
      prisma.slaTimer.findFirst.mockResolvedValue({ id: 'st-1', orgId: 'org-1', status: 'On track' });
      prisma.slaTimer.update.mockResolvedValue({ id: 'st-1' });
      await service.performAction('st-1', 'Pause', undefined, manager);
      expect(prisma.slaTimer.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'st-1' }, data: expect.objectContaining({ pausedAt: expect.any(Date) }) }),
      );
    });

    it('throws BadRequestException for an unknown action', async () => {
      prisma.slaTimer.findFirst.mockResolvedValue({ id: 'st-1', orgId: 'org-1', status: 'Not started' });
      await expect(service.performAction('st-1', 'Bogus', undefined, manager)).rejects.toThrow(BadRequestException);
    });
  });
});
