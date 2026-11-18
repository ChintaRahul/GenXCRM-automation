import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Tutor } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';
import { ErrorMessages } from '../../common/constants/messages';

interface CreateTutorDto {
  name: string;
}

interface UpdateTutorDto {
  isActive?: boolean;
}

@Injectable()
export class TutorsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(caller: AuthUser, includeArchived = false): Promise<Tutor[]> {
    const orgFilter: Prisma.TutorWhereInput = caller.orgId ? { orgId: caller.orgId } : {};
    return this.prisma.tutor.findMany({
      where: { ...orgFilter, ...(includeArchived ? {} : { isActive: true }) },
      orderBy: { name: 'asc' },
    });
  }

  async create(dto: CreateTutorDto, caller: AuthUser): Promise<Tutor> {
    if (!caller.orgId) {
      throw new ForbiddenException(ErrorMessages.tutors.orgRequired);
    }

    return this.prisma.tutor.create({
      data: { orgId: caller.orgId, name: dto.name },
    });
  }

  async update(id: string, dto: UpdateTutorDto, caller: AuthUser): Promise<Tutor> {
    const orgFilter: Prisma.TutorWhereInput = caller.orgId ? { orgId: caller.orgId } : {};
    const tutor = await this.prisma.tutor.findFirst({ where: { id, ...orgFilter } });
    if (!tutor) {
      throw new NotFoundException(ErrorMessages.tutors.notFound);
    }

    return this.prisma.tutor.update({
      where: { id },
      data: { ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}) },
    });
  }
}
