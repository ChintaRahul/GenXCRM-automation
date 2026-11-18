import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateImportMappingDto } from './dto/create-import-mapping.dto';
import { UpdateImportMappingDto } from './dto/update-import-mapping.dto';
import type { AuthUser } from '../../common/types/auth-user.type';
import { ErrorMessages } from '../../common/constants/messages';

@Injectable()
export class ImportMappingsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(user: AuthUser) {
    const where =
      user.role === Role.DIRECTOR && user.orgId ? { createdBy: { orgId: user.orgId } } : { createdById: user.id };

    return this.prisma.importMapping.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: { createdBy: { select: { id: true, name: true } } },
    });
  }

  create(dto: CreateImportMappingDto, user: AuthUser) {
    return this.prisma.importMapping.create({
      data: { name: dto.name, mappings: dto.mappings, createdById: user.id },
    });
  }

  async update(id: string, dto: UpdateImportMappingDto, user: AuthUser) {
    const existing = await this.#findOrFail(id);
    this.#assertOwner(existing, user);
    return this.prisma.importMapping.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.mappings !== undefined && { mappings: dto.mappings }),
      },
    });
  }

  async remove(id: string, user: AuthUser) {
    const existing = await this.#findOrFail(id);
    this.#assertOwner(existing, user);
    await this.prisma.importMapping.delete({ where: { id } });
  }

  async #findOrFail(id: string) {
    const mapping = await this.prisma.importMapping.findUnique({ where: { id } });
    if (!mapping) throw new NotFoundException(ErrorMessages.importMappings.notFound);
    return mapping;
  }

  #assertOwner(mapping: { createdById: string }, user: AuthUser) {
    if (mapping.createdById !== user.id && user.role !== Role.DIRECTOR) {
      throw new ForbiddenException(ErrorMessages.importMappings.notOwner);
    }
  }
}
