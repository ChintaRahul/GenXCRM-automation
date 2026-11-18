import { Injectable, NotFoundException } from '@nestjs/common';
import { AttachmentStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../modules/storage/storage.service';
import type { AuthUser } from '../../common/types/auth-user.type';
import { requireOrgId } from '../utils/require-org-id.util';
import type { InitModuleDocumentDto } from '../dto/module-record-extras.dto';

export interface ModuleDocumentView {
  id: string;
  name: string;
  type: string;
  createdAt: string;
  url: string;
}

// Safe, short extension from the original file name; the object key never contains user text.
const extensionOf = (fileName: string): string => {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : 'bin';
};

// Files attached to a manufacturing module record. Always scoped to the caller's org; the S3
// location only ever leaves this service as a short-lived signed URL (CLAUDE.md rule 6).
@Injectable()
export class ModuleDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async list(moduleKey: string, recordId: string, caller: AuthUser): Promise<ModuleDocumentView[]> {
    const rows = await this.prisma.moduleDocument.findMany({
      where: { orgId: requireOrgId(caller), moduleKey, recordId, status: AttachmentStatus.UPLOADED, isDeleted: false },
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        name: r.fileName,
        type: r.mimeType,
        createdAt: r.createdAt.toISOString(),
        url: await this.storage.getPresignedDownloadUrl(r.s3Key),
      })),
    );
  }

  // Creates the PENDING row and returns a presigned PUT URL for the browser to upload to directly.
  async init(moduleKey: string, recordId: string, dto: InitModuleDocumentDto, caller: AuthUser) {
    const orgId = requireOrgId(caller);
    const id = randomUUID();
    const s3Key = this.storage.buildModuleDocumentKey(orgId, moduleKey, recordId, id, extensionOf(dto.fileName));
    await this.prisma.moduleDocument.create({
      data: { id, orgId, moduleKey, recordId, uploadedById: caller.id, fileName: dto.fileName, mimeType: dto.mimeType, fileSize: dto.fileSize, s3Key },
    });
    return { documentId: id, uploadUrl: await this.storage.getPresignedUploadUrl(s3Key, dto.mimeType) };
  }

  // Marks the upload finished, making the document visible in the list.
  async complete(moduleKey: string, recordId: string, documentId: string, caller: AuthUser): Promise<void> {
    const { count } = await this.prisma.moduleDocument.updateMany({
      where: { id: documentId, orgId: requireOrgId(caller), moduleKey, recordId, isDeleted: false },
      data: { status: AttachmentStatus.UPLOADED },
    });
    if (count === 0) throw new NotFoundException(`Document '${documentId}' not found.`);
  }

  // Soft delete — the row (and S3 object) is kept for retention; it just stops being listed.
  async remove(moduleKey: string, recordId: string, documentId: string, caller: AuthUser): Promise<void> {
    const { count } = await this.prisma.moduleDocument.updateMany({
      where: { id: documentId, orgId: requireOrgId(caller), moduleKey, recordId, isDeleted: false },
      data: { isDeleted: true },
    });
    if (count === 0) throw new NotFoundException(`Document '${documentId}' not found.`);
  }
}
