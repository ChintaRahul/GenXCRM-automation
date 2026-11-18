import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { ModuleDocumentsService } from './module-documents.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../modules/storage/storage.service';
import type { AuthUser } from '../../common/types/auth-user.type';

const caller: AuthUser = { id: 'u1', name: 'U', email: 'u@t.com', role: Role.MANAGER, teamId: null, orgId: 'org-1' };
const mockPrisma = { moduleDocument: { findMany: jest.fn(), create: jest.fn(), updateMany: jest.fn() } };
const mockStorage = {
  buildModuleDocumentKey: jest.fn().mockReturnValue('orgs/org-1/modules/rfqs/r1/doc.pdf'),
  getPresignedUploadUrl: jest.fn().mockResolvedValue('https://s3/put'),
  getPresignedDownloadUrl: jest.fn().mockResolvedValue('https://s3/get'),
};

describe('ModuleDocumentsService', () => {
  let service: ModuleDocumentsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        ModuleDocumentsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: StorageService, useValue: mockStorage },
      ],
    }).compile();
    service = module.get(ModuleDocumentsService);
  });

  it('lists only uploaded, non-deleted documents of the org and record, with signed URLs and no s3 key', async () => {
    mockPrisma.moduleDocument.findMany.mockResolvedValue([
      { id: 'd1', fileName: 'spec.pdf', mimeType: 'application/pdf', createdAt: new Date('2026-10-01T00:00:00Z'), s3Key: 'secret/key' },
    ]);
    const result = await service.list('rfqs', 'r1', caller);
    expect(mockPrisma.moduleDocument.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ orgId: 'org-1', moduleKey: 'rfqs', recordId: 'r1', status: 'UPLOADED', isDeleted: false }),
      }),
    );
    expect(result).toEqual([{ id: 'd1', name: 'spec.pdf', type: 'application/pdf', createdAt: '2026-10-01T00:00:00.000Z', url: 'https://s3/get' }]);
    expect(JSON.stringify(result)).not.toContain('secret/key');
  });

  it('creates a PENDING row for the org and returns a presigned upload URL', async () => {
    const result = await service.init('rfqs', 'r1', { fileName: 'Spec Sheet.PDF', mimeType: 'application/pdf', fileSize: 1000 }, caller);
    expect(mockPrisma.moduleDocument.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orgId: 'org-1',
        moduleKey: 'rfqs',
        recordId: 'r1',
        uploadedById: 'u1',
        fileName: 'Spec Sheet.PDF',
        s3Key: 'orgs/org-1/modules/rfqs/r1/doc.pdf',
      }),
    });
    expect(mockStorage.buildModuleDocumentKey).toHaveBeenCalledWith('org-1', 'rfqs', 'r1', expect.any(String), 'pdf');
    expect(result).toEqual({ documentId: expect.any(String), uploadUrl: 'https://s3/put' });
  });

  it('falls back to a safe bin extension for odd file names', async () => {
    await service.init('rfqs', 'r1', { fileName: 'weird.p/d f', mimeType: 'application/pdf', fileSize: 10 }, caller);
    expect(mockStorage.buildModuleDocumentKey).toHaveBeenCalledWith('org-1', 'rfqs', 'r1', expect.any(String), 'bin');
  });

  it('completes and removes within the org and record, and 404s otherwise', async () => {
    mockPrisma.moduleDocument.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 1 });
    await service.complete('rfqs', 'r1', 'd1', caller);
    await service.remove('rfqs', 'r1', 'd1', caller);
    expect(mockPrisma.moduleDocument.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({ id: 'd1', orgId: 'org-1', moduleKey: 'rfqs', recordId: 'r1' }),
        data: { status: 'UPLOADED' },
      }),
    );
    expect(mockPrisma.moduleDocument.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({ data: { isDeleted: true } }));
    mockPrisma.moduleDocument.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.complete('rfqs', 'r1', 'x', caller)).rejects.toThrow(NotFoundException);
    await expect(service.remove('rfqs', 'r1', 'x', caller)).rejects.toThrow(NotFoundException);
  });
});
