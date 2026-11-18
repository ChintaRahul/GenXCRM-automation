import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TutorsService } from './tutors.service';
import type { AuthUser } from '../../common/types/auth-user.type';

const director = { id: 'u1', role: Role.DIRECTOR, orgId: 'org-1' } as AuthUser;

describe('TutorsService', () => {
  let service: TutorsService;
  let prisma: {
    tutor: { findMany: jest.Mock; create: jest.Mock; findFirst: jest.Mock; update: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      tutor: {
        findMany: jest.fn(),
        create: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    };
    const module = await Test.createTestingModule({
      providers: [TutorsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(TutorsService);
  });

  describe('list', () => {
    it('scopes the query to caller.orgId and isActive', async () => {
      prisma.tutor.findMany.mockResolvedValue([]);
      await service.list(director);
      expect(prisma.tutor.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ orgId: 'org-1', isActive: true }),
        }),
      );
    });

    it('orders by name ascending', async () => {
      prisma.tutor.findMany.mockResolvedValue([]);
      await service.list(director);
      expect(prisma.tutor.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { name: 'asc' } }));
    });

    it('includes archived tutors when includeArchived is true', async () => {
      prisma.tutor.findMany.mockResolvedValue([]);
      await service.list(director, true);
      expect(prisma.tutor.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { orgId: 'org-1' } }),
      );
    });
  });

  describe('create', () => {
    it('creates a tutor scoped to caller.orgId', async () => {
      const created = { id: 't1', orgId: 'org-1', name: 'Ms. Anjali Rao', isActive: true };
      prisma.tutor.create.mockResolvedValue(created);

      const result = await service.create({ name: 'Ms. Anjali Rao' }, director);

      expect(prisma.tutor.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ orgId: 'org-1', name: 'Ms. Anjali Rao' }) }),
      );
      expect(result).toEqual(created);
    });

    it('throws ForbiddenException when caller.orgId is missing', async () => {
      const caller = { ...director, orgId: null } as AuthUser;
      await expect(service.create({ name: 'Ms. Anjali Rao' }, caller)).rejects.toThrow(ForbiddenException);
      expect(prisma.tutor.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('scopes the lookup to caller.orgId and updates isActive', async () => {
      const existing = { id: 't1', orgId: 'org-1', name: 'Ms. Anjali Rao', isActive: true };
      prisma.tutor.findFirst.mockResolvedValue(existing);
      prisma.tutor.update.mockResolvedValue({ ...existing, isActive: false });

      const result = await service.update('t1', { isActive: false }, director);

      expect(prisma.tutor.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 't1', orgId: 'org-1' } }),
      );
      expect(prisma.tutor.update).toHaveBeenCalledWith({
        where: { id: 't1' },
        data: { isActive: false },
      });
      expect(result.isActive).toBe(false);
    });

    it('throws NotFoundException when the tutor is not in the caller org', async () => {
      prisma.tutor.findFirst.mockResolvedValue(null);
      await expect(service.update('t1', { isActive: false }, director)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.tutor.update).not.toHaveBeenCalled();
    });
  });
});
