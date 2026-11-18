import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { DocumentTemplatesService } from './document-templates.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';

describe('DocumentTemplatesService', () => {
  let service: DocumentTemplatesService;
  let prisma: any;

  const salesRep: AuthUser = { id: 'u1', orgId: 'org-1', role: Role.SALES_REP } as AuthUser;
  const manager: AuthUser = { id: 'u2', orgId: 'org-1', role: Role.MANAGER } as AuthUser;

  beforeEach(async () => {
    prisma = {
      documentTemplate: { findMany: jest.fn(), count: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    };
    const module = await Test.createTestingModule({
      providers: [DocumentTemplatesService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(DocumentTemplatesService);
  });

  describe('findAll', () => {
    it('scopes to orgId only for every role', async () => {
      prisma.documentTemplate.findMany.mockResolvedValue([]);
      prisma.documentTemplate.count.mockResolvedValue(0);
      await service.findAll({ page: 1, limit: 20 }, salesRep);
      const where = prisma.documentTemplate.findMany.mock.calls[0][0].where;
      expect(where).toEqual(expect.objectContaining({ orgId: 'org-1' }));
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when not found', async () => {
      prisma.documentTemplate.findFirst.mockResolvedValue(null);
      await expect(service.findOne('missing', manager)).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('creates with requireOrgId-derived orgId', async () => {
      prisma.documentTemplate.create.mockResolvedValue({ id: 'dt-1' });
      await service.create({ name: 'Quotation PDF', numberingPattern: 'QT-{YY}{MM}-{####}' } as any, manager);
      expect(prisma.documentTemplate.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ orgId: 'org-1', name: 'Quotation PDF' }) }),
      );
    });
  });

  describe('update', () => {
    it('merges plain fields', async () => {
      prisma.documentTemplate.findFirst.mockResolvedValue({ id: 'dt-1', orgId: 'org-1' });
      prisma.documentTemplate.update.mockResolvedValue({ id: 'dt-1' });
      await service.update('dt-1', { description: 'Updated' } as any, manager);
      expect(prisma.documentTemplate.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ description: 'Updated' }) }),
      );
    });
  });
});
