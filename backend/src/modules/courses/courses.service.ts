import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Course, CourseCategory, CourseSource, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';
import { ErrorMessages } from '../../common/constants/messages';
import { CreateCourseDto } from './dto/create-course.dto';
import { UpdateCourseDto } from './dto/update-course.dto';
import { AddBatchDto } from './dto/add-batch.dto';

const courseInclude = {
  batches: { where: { isActive: true }, include: { tutor: true }, orderBy: { createdAt: 'asc' as const } },
};

@Injectable()
export class CoursesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(caller: AuthUser, includeArchived = false) {
    const orgFilter: Prisma.CourseWhereInput = caller.orgId ? { orgId: caller.orgId } : {};
    return this.prisma.course.findMany({
      where: { ...orgFilter, ...(includeArchived ? {} : { isActive: true }) },
      orderBy: { name: 'asc' },
      include: courseInclude,
    });
  }

  async create(dto: CreateCourseDto, caller: AuthUser): Promise<Course> {
    if (!caller.orgId) {
      throw new ForbiddenException(ErrorMessages.courses.orgRequired);
    }

    return this.prisma.course.create({
      data: {
        orgId: caller.orgId,
        name: dto.name,
        defaultPrice: dto.defaultPrice,
        category: dto.category ?? CourseCategory.OTHER,
      },
    });
  }

  async update(id: string, dto: UpdateCourseDto, caller: AuthUser): Promise<Course> {
    const orgFilter: Prisma.CourseWhereInput = caller.orgId ? { orgId: caller.orgId } : {};
    const course = await this.prisma.course.findFirst({ where: { id, ...orgFilter } });
    if (!course) {
      throw new NotFoundException(ErrorMessages.courses.notFound);
    }

    return this.prisma.course.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.category !== undefined && { category: dto.category }),
        ...(dto.defaultPrice !== undefined && { defaultPrice: dto.defaultPrice }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
  }

  async remove(id: string, caller: AuthUser): Promise<Course> {
    const orgFilter: Prisma.CourseWhereInput = caller.orgId ? { orgId: caller.orgId } : {};
    const course = await this.prisma.course.findFirst({ where: { id, ...orgFilter } });
    if (!course) {
      throw new NotFoundException(ErrorMessages.courses.notFound);
    }

    return this.prisma.course.update({ where: { id }, data: { isActive: false } });
  }

  async addBatch(courseId: string, dto: AddBatchDto, caller: AuthUser) {
    const orgFilter: Prisma.CourseWhereInput = caller.orgId ? { orgId: caller.orgId } : {};
    const course = await this.prisma.course.findFirst({ where: { id: courseId, ...orgFilter } });
    if (!course) {
      throw new NotFoundException(ErrorMessages.courses.notFound);
    }

    // dto.tutorId is caller-supplied — without this check, a caller could link a batch to
    // a tutor belonging to another org (IDOR) since Batch has no orgId of its own.
    if (dto.tutorId) {
      const tutorOrgFilter: Prisma.TutorWhereInput = caller.orgId ? { orgId: caller.orgId } : {};
      const tutor = await this.prisma.tutor.findFirst({ where: { id: dto.tutorId, ...tutorOrgFilter } });
      if (!tutor) {
        throw new NotFoundException(ErrorMessages.courses.tutorNotFound);
      }
    }

    return this.prisma.batch.create({
      data: {
        courseId,
        label: dto.label,
        schedule: dto.schedule || 'TBD',
        tutorId: dto.tutorId,
        capacity: dto.capacity,
      },
      include: { tutor: true },
    });
  }

  async removeBatch(courseId: string, batchId: string, caller: AuthUser) {
    const orgFilter: Prisma.CourseWhereInput = caller.orgId ? { orgId: caller.orgId } : {};
    const course = await this.prisma.course.findFirst({ where: { id: courseId, ...orgFilter } });
    if (!course) {
      throw new NotFoundException(ErrorMessages.courses.notFound);
    }

    const batch = await this.prisma.batch.findFirst({ where: { id: batchId, courseId, isActive: true } });
    if (!batch) {
      throw new NotFoundException(ErrorMessages.courses.batchNotFound);
    }

    // Soft-delete only (see the isActive comment on the Batch model) — a hard delete would
    // SET NULL the batchId on any InvoiceLineItem that references it, silently erasing which
    // batch a past registration was actually for.
    await this.prisma.batch.update({ where: { id: batchId }, data: { isActive: false } });
  }

  async ensureCourseFromLead(courseName: string, leadName: string, orgId: string): Promise<void> {
    const normalized = courseName.trim().toLowerCase();
    if (!normalized) return;

    const existing = await this.prisma.course.findFirst({
      where: { orgId, name: { equals: normalized, mode: 'insensitive' } },
    });
    if (existing) return;

    await this.prisma.course.create({
      data: {
        orgId,
        name: courseName.trim(),
        defaultPrice: 0,
        category: CourseCategory.OTHER,
        source: CourseSource.LEAD,
        leadName,
        isActive: true,
      },
    });
  }
}
