import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { ImportMappingsService } from './import-mappings.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';

const mockPrisma = {
  importMapping: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
};

const repUser: AuthUser = {
  id: 'rep-1',
  name: 'Rep',
  email: 'rep@t.com',
  role: Role.SALES_REP,
  teamId: 'team-1',
  orgId: null,
};
const directorUser: AuthUser = {
  id: 'dir-1',
  name: 'Dir',
  email: 'dir@t.com',
  role: Role.DIRECTOR,
  teamId: null,
  orgId: 'org-1',
};

const mockMapping = {
  id: 'map-1',
  name: 'Template A',
  mappings: { name: 'Full Name', phone: 'Mobile' },
  createdById: 'rep-1',
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('ImportMappingsService', () => {
  let service: ImportMappingsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [ImportMappingsService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get(ImportMappingsService);
  });

  describe('findAll', () => {
    it('scopes to createdById for SALES_REP', async () => {
      mockPrisma.importMapping.findMany.mockResolvedValue([]);
      await service.findAll(repUser);
      expect(mockPrisma.importMapping.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { createdById: 'rep-1' } }),
      );
    });

    it('scopes to org for DIRECTOR with orgId', async () => {
      mockPrisma.importMapping.findMany.mockResolvedValue([]);
      await service.findAll(directorUser);
      expect(mockPrisma.importMapping.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { createdBy: { orgId: 'org-1' } } }),
      );
    });
  });

  describe('create', () => {
    it('creates mapping with createdById from caller', async () => {
      mockPrisma.importMapping.create.mockResolvedValue(mockMapping);
      await service.create({ name: 'Template A', mappings: { name: 'Full Name' } }, repUser);
      expect(mockPrisma.importMapping.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ createdById: 'rep-1' }) }),
      );
    });
  });

  describe('update', () => {
    it('updates own record', async () => {
      mockPrisma.importMapping.findUnique.mockResolvedValue(mockMapping);
      mockPrisma.importMapping.update.mockResolvedValue({ ...mockMapping, name: 'Renamed' });
      const result = await service.update('map-1', { name: 'Renamed' }, repUser);
      expect(result.name).toBe('Renamed');
    });

    it('throws ForbiddenException when not the owner', async () => {
      const otherMapping = { ...mockMapping, createdById: 'other-user' };
      mockPrisma.importMapping.findUnique.mockResolvedValue(otherMapping);
      await expect(service.update('map-1', { name: 'X' }, repUser)).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when mapping not found', async () => {
      mockPrisma.importMapping.findUnique.mockResolvedValue(null);
      await expect(service.update('bad-id', { name: 'X' }, repUser)).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('deletes own record', async () => {
      mockPrisma.importMapping.findUnique.mockResolvedValue(mockMapping);
      mockPrisma.importMapping.delete.mockResolvedValue({});
      await service.remove('map-1', repUser);
      expect(mockPrisma.importMapping.delete).toHaveBeenCalledWith({ where: { id: 'map-1' } });
    });

    it('throws ForbiddenException when not the owner', async () => {
      mockPrisma.importMapping.findUnique.mockResolvedValue({ ...mockMapping, createdById: 'other-user' });
      await expect(service.remove('map-1', repUser)).rejects.toThrow(ForbiddenException);
    });

    it('allows DIRECTOR to delete any mapping', async () => {
      mockPrisma.importMapping.findUnique.mockResolvedValue({ ...mockMapping, createdById: 'other-user' });
      mockPrisma.importMapping.delete.mockResolvedValue({});
      await expect(service.remove('map-1', directorUser)).resolves.not.toThrow();
    });
  });
});
