import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { ApprovalRulesService } from './approval-rules.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';

describe('ApprovalRulesService', () => {
  let service: ApprovalRulesService;
  let prisma: any;

  const salesRep: AuthUser = { id: 'u1', orgId: 'org-1', role: Role.SALES_REP } as AuthUser;
  const manager: AuthUser = { id: 'u2', orgId: 'org-1', role: Role.MANAGER } as AuthUser;

  beforeEach(async () => {
    prisma = {
      approvalRule: { findMany: jest.fn(), count: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    };
    const module = await Test.createTestingModule({
      providers: [ApprovalRulesService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(ApprovalRulesService);
  });

  describe('findAll', () => {
    it('scopes to orgId only for every role, including SALES_REP (no ownerId on this model)', async () => {
      prisma.approvalRule.findMany.mockResolvedValue([]);
      prisma.approvalRule.count.mockResolvedValue(0);
      await service.findAll({ page: 1, limit: 20 }, salesRep);
      const where = prisma.approvalRule.findMany.mock.calls[0][0].where;
      expect(where).toEqual(expect.objectContaining({ orgId: 'org-1' }));
      expect(where.ownerId).toBeUndefined();
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when not found', async () => {
      prisma.approvalRule.findFirst.mockResolvedValue(null);
      await expect(service.findOne('missing', manager)).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('creates with status isActive true and requireOrgId-derived orgId', async () => {
      prisma.approvalRule.create.mockResolvedValue({ id: 'ar-1' });
      await service.create({ type: 'Discount', min: 0, max: 5, approverRole: 'Salesperson' } as any, manager);
      expect(prisma.approvalRule.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ orgId: 'org-1', isActive: true }) }),
      );
    });
  });

  describe('update', () => {
    it('merges plain fields', async () => {
      prisma.approvalRule.findFirst.mockResolvedValue({ id: 'ar-1', orgId: 'org-1', isActive: true });
      prisma.approvalRule.update.mockResolvedValue({ id: 'ar-1' });
      await service.update('ar-1', { approverRole: 'Sales Manager' } as any, manager);
      expect(prisma.approvalRule.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ approverRole: 'Sales Manager' }) }),
      );
    });
  });

  describe('performAction', () => {
    it('Deactivate succeeds when currently active', async () => {
      prisma.approvalRule.findFirst.mockResolvedValue({ id: 'ar-1', orgId: 'org-1', isActive: true });
      prisma.approvalRule.update.mockResolvedValue({ id: 'ar-1', isActive: false });
      await service.performAction('ar-1', 'Deactivate', undefined, manager);
      expect(prisma.approvalRule.update).toHaveBeenCalledWith({ where: { id: 'ar-1' }, data: { isActive: false } });
    });

    it('Deactivate rejects the last active Margin rule, scoped to the org', async () => {
      prisma.approvalRule.findFirst.mockResolvedValue({ id: 'ar-1', orgId: 'org-1', type: 'Margin', isActive: true });
      prisma.approvalRule.count.mockResolvedValue(0);
      await expect(service.performAction('ar-1', 'Deactivate', undefined, manager)).rejects.toThrow(BadRequestException);
      expect(prisma.approvalRule.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1', type: 'Margin' }) }),
      );
      expect(prisma.approvalRule.update).not.toHaveBeenCalled();
    });

    it('Deactivate allows a Margin rule when another active one remains', async () => {
      prisma.approvalRule.findFirst.mockResolvedValue({ id: 'ar-1', orgId: 'org-1', type: 'Margin', isActive: true });
      prisma.approvalRule.count.mockResolvedValue(1);
      prisma.approvalRule.update.mockResolvedValue({ id: 'ar-1' });
      await service.performAction('ar-1', 'Deactivate', undefined, manager);
      expect(prisma.approvalRule.update).toHaveBeenCalled();
    });

    it('archive rejects the last active Margin rule', async () => {
      prisma.approvalRule.findFirst.mockResolvedValue({ id: 'ar-1', orgId: 'org-1', type: 'Margin', isActive: true });
      prisma.approvalRule.count.mockResolvedValue(0);
      await expect(service.archive('ar-1', manager)).rejects.toThrow(BadRequestException);
    });

    it('Deactivate rejects when already inactive', async () => {
      prisma.approvalRule.findFirst.mockResolvedValue({ id: 'ar-1', orgId: 'org-1', isActive: false });
      await expect(service.performAction('ar-1', 'Deactivate', undefined, manager)).rejects.toThrow(BadRequestException);
    });

    it('Activate succeeds when currently inactive', async () => {
      prisma.approvalRule.findFirst.mockResolvedValue({ id: 'ar-1', orgId: 'org-1', isActive: false });
      prisma.approvalRule.update.mockResolvedValue({ id: 'ar-1', isActive: true });
      await service.performAction('ar-1', 'Activate', undefined, manager);
      expect(prisma.approvalRule.update).toHaveBeenCalledWith({ where: { id: 'ar-1' }, data: { isActive: true } });
    });

    it('Activate rejects when already active', async () => {
      prisma.approvalRule.findFirst.mockResolvedValue({ id: 'ar-1', orgId: 'org-1', isActive: true });
      await expect(service.performAction('ar-1', 'Activate', undefined, manager)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for an unknown action', async () => {
      prisma.approvalRule.findFirst.mockResolvedValue({ id: 'ar-1', orgId: 'org-1', isActive: true });
      await expect(service.performAction('ar-1', 'Bogus', undefined, manager)).rejects.toThrow(BadRequestException);
    });
  });
});
