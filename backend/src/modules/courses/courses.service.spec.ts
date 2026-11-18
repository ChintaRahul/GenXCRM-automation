import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { CourseCategory, CourseSource, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CoursesService } from './courses.service';
import type { AuthUser } from '../../common/types/auth-user.type';

const director = { id: 'u1', role: Role.DIRECTOR, orgId: 'org-1' } as AuthUser;

describe('CoursesService', () => {
  let service: CoursesService;
  let prisma: {
    course: { findMany: jest.Mock; create: jest.Mock; findFirst: jest.Mock; update: jest.Mock };
    batch: { create: jest.Mock; findFirst: jest.Mock; update: jest.Mock; delete: jest.Mock };
    tutor: { findFirst: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      course: {
        findMany: jest.fn(),
        create: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      batch: {
        create: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      tutor: {
        findFirst: jest.fn(),
      },
    };
    const module = await Test.createTestingModule({
      providers: [CoursesService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(CoursesService);
  });

  describe('list', () => {
    it('scopes the query to caller.orgId and isActive', async () => {
      prisma.course.findMany.mockResolvedValue([]);
      await service.list(director);
      expect(prisma.course.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ orgId: 'org-1', isActive: true }),
        }),
      );
    });

    it('orders by name ascending', async () => {
      prisma.course.findMany.mockResolvedValue([]);
      await service.list(director);
      expect(prisma.course.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { name: 'asc' } }));
    });

    it('includes batches with their tutor', async () => {
      prisma.course.findMany.mockResolvedValue([]);
      await service.list(director);
      expect(prisma.course.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            batches: expect.objectContaining({ include: { tutor: true } }),
          }),
        }),
      );
    });

    it('returns the happy-path shape', async () => {
      const courses = [{ id: 'c1', orgId: 'org-1', name: 'Python 101', defaultPrice: 5000, isActive: true }];
      prisma.course.findMany.mockResolvedValue(courses);
      const result = await service.list(director);
      expect(result).toEqual(courses);
    });

    it('includes archived courses when includeArchived is true', async () => {
      prisma.course.findMany.mockResolvedValue([]);
      await service.list(director, true);
      expect(prisma.course.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { orgId: 'org-1' } }),
      );
    });
  });

  describe('create', () => {
    it('creates a course scoped to caller.orgId', async () => {
      const created = { id: 'c1', orgId: 'org-1', name: 'Python 101', defaultPrice: 5000, isActive: true };
      prisma.course.create.mockResolvedValue(created);

      const result = await service.create({ name: 'Python 101', defaultPrice: 5000 }, director);

      expect(prisma.course.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ orgId: 'org-1', name: 'Python 101', defaultPrice: 5000 }),
        }),
      );
      expect(result).toEqual(created);
    });

    it('throws ForbiddenException when caller.orgId is missing', async () => {
      const caller = { ...director, orgId: null } as AuthUser;
      await expect(service.create({ name: 'Python 101', defaultPrice: 5000 }, caller)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.course.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('updates a course scoped to caller.orgId', async () => {
      prisma.course.findFirst.mockResolvedValue({ id: 'c1', orgId: 'org-1' });
      prisma.course.update.mockResolvedValue({ id: 'c1', name: 'New name' });

      await service.update('c1', { name: 'New name' }, director);

      expect(prisma.course.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: 'c1', orgId: 'org-1' }) }),
      );
      expect(prisma.course.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'c1' }, data: expect.objectContaining({ name: 'New name' }) }),
      );
    });

    it('throws NotFoundException when the course is outside the caller org', async () => {
      prisma.course.findFirst.mockResolvedValue(null);
      await expect(service.update('c1', { name: 'X' }, director)).rejects.toThrow(NotFoundException);
      expect(prisma.course.update).not.toHaveBeenCalled();
    });

    it('restores an archived course via isActive: true', async () => {
      prisma.course.findFirst.mockResolvedValue({ id: 'c1', orgId: 'org-1', isActive: false });
      prisma.course.update.mockResolvedValue({ id: 'c1', isActive: true });

      await service.update('c1', { isActive: true }, director);

      expect(prisma.course.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'c1' }, data: expect.objectContaining({ isActive: true }) }),
      );
    });
  });

  describe('remove', () => {
    it('soft-deletes via isActive: false, scoped to caller.orgId', async () => {
      prisma.course.findFirst.mockResolvedValue({ id: 'c1', orgId: 'org-1' });
      prisma.course.update.mockResolvedValue({ id: 'c1', isActive: false });

      await service.remove('c1', director);

      expect(prisma.course.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { isActive: false } });
    });

    it('throws NotFoundException when the course is outside the caller org', async () => {
      prisma.course.findFirst.mockResolvedValue(null);
      await expect(service.remove('c1', director)).rejects.toThrow(NotFoundException);
    });
  });

  describe('addBatch', () => {
    it('creates a batch under a course scoped to caller.orgId', async () => {
      prisma.course.findFirst.mockResolvedValue({ id: 'c1', orgId: 'org-1' });
      prisma.tutor.findFirst.mockResolvedValue({ id: 't1', orgId: 'org-1' });
      prisma.batch.create.mockResolvedValue({ id: 'b1' });

      await service.addBatch('c1', { label: 'Batch A', schedule: 'Mon', tutorId: 't1', capacity: 20 }, director);

      expect(prisma.course.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: 'c1', orgId: 'org-1' }) }),
      );
      expect(prisma.tutor.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: 't1', orgId: 'org-1' }) }),
      );
      expect(prisma.batch.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            courseId: 'c1',
            label: 'Batch A',
            schedule: 'Mon',
            tutorId: 't1',
            capacity: 20,
          }),
        }),
      );
    });

    it('throws NotFoundException when tutorId does not belong to caller.orgId (cross-tenant IDOR)', async () => {
      prisma.course.findFirst.mockResolvedValue({ id: 'c1', orgId: 'org-1' });
      prisma.tutor.findFirst.mockResolvedValue(null);

      await expect(
        service.addBatch('c1', { label: 'Batch A', schedule: 'Mon', tutorId: 'other-org-tutor', capacity: 20 }, director),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.batch.create).not.toHaveBeenCalled();
    });

    it('skips the tutor lookup entirely when no tutorId is given', async () => {
      prisma.course.findFirst.mockResolvedValue({ id: 'c1', orgId: 'org-1' });
      prisma.batch.create.mockResolvedValue({ id: 'b1' });

      await service.addBatch('c1', { label: 'Batch A', schedule: 'Mon', capacity: 20 }, director);

      expect(prisma.tutor.findFirst).not.toHaveBeenCalled();
      expect(prisma.batch.create).toHaveBeenCalled();
    });

    it('defaults schedule to TBD when blank', async () => {
      prisma.course.findFirst.mockResolvedValue({ id: 'c1', orgId: 'org-1' });
      prisma.batch.create.mockResolvedValue({ id: 'b1' });

      await service.addBatch('c1', { label: 'Batch A', schedule: '', capacity: 20 }, director);

      expect(prisma.batch.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ schedule: 'TBD' }) }),
      );
    });

    it('throws NotFoundException when the course is outside the caller org', async () => {
      prisma.course.findFirst.mockResolvedValue(null);
      await expect(
        service.addBatch('c1', { label: 'Batch A', schedule: 'Mon', capacity: 20 }, director),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.batch.create).not.toHaveBeenCalled();
    });
  });

  describe('removeBatch', () => {
    it('soft-deletes a batch (isActive: false) scoped through the parent course', async () => {
      prisma.course.findFirst.mockResolvedValue({ id: 'c1', orgId: 'org-1' });
      prisma.batch.findFirst.mockResolvedValue({ id: 'b1', courseId: 'c1', isActive: true });

      await service.removeBatch('c1', 'b1', director);

      expect(prisma.batch.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ isActive: true }) }),
      );
      expect(prisma.batch.update).toHaveBeenCalledWith({ where: { id: 'b1' }, data: { isActive: false } });
      expect(prisma.batch.delete).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the course is outside the caller org', async () => {
      prisma.course.findFirst.mockResolvedValue(null);
      await expect(service.removeBatch('c1', 'b1', director)).rejects.toThrow(NotFoundException);
      expect(prisma.batch.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the batch does not belong to the course', async () => {
      prisma.course.findFirst.mockResolvedValue({ id: 'c1', orgId: 'org-1' });
      prisma.batch.findFirst.mockResolvedValue(null);
      await expect(service.removeBatch('c1', 'b1', director)).rejects.toThrow(NotFoundException);
      expect(prisma.batch.update).not.toHaveBeenCalled();
    });
  });

  describe('ensureCourseFromLead', () => {
    it('creates a new lead-sourced course when no case-insensitive match exists', async () => {
      prisma.course.findFirst.mockResolvedValue(null);
      prisma.course.create.mockResolvedValue({ id: 'c1' });

      await service.ensureCourseFromLead('Business English', 'Fatima Sheikh', 'org-1');

      expect(prisma.course.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orgId: 'org-1', name: { equals: 'business english', mode: 'insensitive' } },
        }),
      );
      expect(prisma.course.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            orgId: 'org-1',
            name: 'Business English',
            defaultPrice: 0,
            category: CourseCategory.OTHER,
            source: CourseSource.LEAD,
            leadName: 'Fatima Sheikh',
          }),
        }),
      );
    });

    it('does nothing when a matching course already exists (case-insensitive)', async () => {
      prisma.course.findFirst.mockResolvedValue({ id: 'existing' });

      await service.ensureCourseFromLead('ielts prep', 'Rohan Verma', 'org-1');

      expect(prisma.course.create).not.toHaveBeenCalled();
    });

    it('does nothing when the course name is blank', async () => {
      await service.ensureCourseFromLead('   ', 'Rohan Verma', 'org-1');
      expect(prisma.course.findFirst).not.toHaveBeenCalled();
      expect(prisma.course.create).not.toHaveBeenCalled();
    });
  });
});
