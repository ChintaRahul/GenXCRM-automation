import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Role, LeadStage, LeadSource, Industry, OrgSize } from '@prisma/client';
import { SYSTEM_ACTIVITY_TYPES } from '../../common/constants/lead.constants';
import { LeadsService } from './leads.service';
import { leadActivityInRange, leadInRange } from '../../common/utils/lead-range.util';
import { PrismaService } from '../../prisma/prisma.service';
import { TrialService } from '../trial/trial.service';
import { AssignmentsService } from '../assignments/assignments.service';
import { NurturingService } from '../nurturing/nurturing.service';
import { CampaignsService } from '../campaigns/campaigns.service';
import { CoursesService } from '../courses/courses.service';
import type { AuthUser } from '../../common/types/auth-user.type';
import { ErrorMessages } from '../../common/constants/messages';

const mockPrisma = {
  lead: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    count: jest.fn(),
    groupBy: jest.fn(),
  },
  stageConfig: { findFirst: jest.fn() },
  activity: { create: jest.fn() },
  user: { findFirst: jest.fn() },
  organization: { findUnique: jest.fn() },
  communication: { count: jest.fn() },
  $executeRaw: jest.fn(),
  $transaction: jest.fn(),
};

const repUser: AuthUser = {
  id: 'rep-1',
  name: 'Rep One',
  email: 'rep@test.com',
  role: Role.SALES_REP,
  teamId: 'team-1',
  orgId: 'org-1',
};
const managerUser: AuthUser = {
  id: 'mgr-1',
  name: 'Manager',
  email: 'mgr@test.com',
  role: Role.MANAGER,
  teamId: 'team-1',
  orgId: 'org-1',
};
const directorUser: AuthUser = {
  id: 'dir-1',
  name: 'Director',
  email: 'dir@test.com',
  role: Role.DIRECTOR,
  teamId: null,
  orgId: 'org-1',
};

const mockLead = {
  id: 'lead-1',
  name: 'John',
  phone: '9999999999',
  assignedToId: 'rep-1',
  teamId: 'team-1',
  orgId: 'org-1',
  isDeleted: false,
  source: LeadSource.OTHER,
};

describe('LeadsService', () => {
  let service: LeadsService;

  const mockAssignments = {
    queueForAssignment: jest.fn().mockResolvedValue(undefined),
    queueForAssignmentOrg: jest.fn().mockResolvedValue(undefined),
    queueAutomaticAssignment: jest.fn().mockResolvedValue(undefined),
  };
  const mockNurturing = { autoEnroll: jest.fn().mockResolvedValue(undefined) };
  const mockCampaigns = { resolveHierarchy: jest.fn().mockResolvedValue({}) };
  const mockCourses = { ensureCourseFromLead: jest.fn().mockResolvedValue(undefined) };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn(mockPrisma));
    const module = await Test.createTestingModule({
      providers: [
        LeadsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: TrialService, useValue: { checkLimit: jest.fn() } },
        { provide: AssignmentsService, useValue: mockAssignments },
        { provide: NurturingService, useValue: mockNurturing },
        { provide: CampaignsService, useValue: mockCampaigns },
        { provide: CoursesService, useValue: mockCourses },
      ],
    }).compile();
    service = module.get(LeadsService);
  });

  describe('create', () => {
    it('stores orgId from caller on the new lead', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.create.mockResolvedValue(mockLead);
      await service.create({ name: 'John', phone: '9999999999', source: LeadSource.OTHER }, repUser);
      expect(mockPrisma.lead.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ orgId: 'org-1' }) }),
      );
    });

    it("queues automatic assignment (respecting Routing settings) for the new lead's team and source", async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.create.mockResolvedValue(mockLead);
      await service.create({ name: 'John', phone: '9999999999', source: LeadSource.OTHER }, repUser);
      expect(mockAssignments.queueAutomaticAssignment).toHaveBeenCalledWith(
        'lead-1',
        'org-1',
        'team-1',
        LeadSource.OTHER,
      );
    });

    it('passes a null teamId when the new lead has no team (e.g. Director import)', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.create.mockResolvedValue({ ...mockLead, teamId: null, orgId: 'org-1' });
      await service.create({ name: 'John', phone: '9999999999', source: LeadSource.OTHER }, directorUser);
      expect(mockAssignments.queueAutomaticAssignment).toHaveBeenCalledWith('lead-1', 'org-1', null, LeadSource.OTHER);
    });

    it('scopes dedup check to caller orgId', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.create.mockResolvedValue(mockLead);
      await service.create({ name: 'John', phone: '9999999999', source: LeadSource.OTHER }, repUser);
      expect(mockPrisma.lead.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1' }) }),
      );
    });

    it('normalizes altEmail to lowercase/trimmed on create', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.create.mockResolvedValue(mockLead);
      await service.create(
        { name: 'John', phone: '9999999999', source: LeadSource.OTHER, altEmail: '  Alt@Example.com  ' },
        repUser,
      );
      expect(mockPrisma.lead.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ altEmail: 'alt@example.com' }) }),
      );
    });

    it('throws BadRequestException when phone has fewer than 10 digits', async () => {
      await expect(service.create({ name: 'John', phone: '99999', source: LeadSource.OTHER }, repUser)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockPrisma.lead.create).not.toHaveBeenCalled();
    });

    it('throws ConflictException when phone duplicate exists', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(mockLead);
      await expect(
        service.create({ name: 'John', phone: '9999999999', source: LeadSource.OTHER }, repUser),
      ).rejects.toThrow(ConflictException);
    });

    it('bumps activityAt on the existing lead when a same-course duplicate is resubmitted', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue({ ...mockLead, course: 'MBA' });
      await expect(
        service.create({ name: 'John', phone: '9999999999', course: 'MBA', source: LeadSource.OTHER }, repUser),
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.lead.update).toHaveBeenCalledWith({
        where: { id: 'lead-1' },
        data: { activityAt: expect.any(Date) },
      });
      expect(mockPrisma.lead.create).not.toHaveBeenCalled();
    });

    it('does not resurface or log anything when a CSV import row is a duplicate', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(mockLead);
      await expect(
        service.create({ name: 'John', phone: '9999999999', source: LeadSource.OTHER }, repUser, {
          deferNurturing: true,
          touchOnDuplicate: false,
        }),
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.lead.update).not.toHaveBeenCalled();
      expect(mockPrisma.activity.create).not.toHaveBeenCalled();
    });

    it('logs a RESUBMITTED activity (attributed to the caller) when a duplicate is submitted again', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(mockLead);
      await expect(
        service.create({ name: 'John', phone: '9999999999', source: LeadSource.OTHER }, repUser),
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.activity.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          leadId: 'lead-1',
          userId: repUser.id,
          type: 'RESUBMITTED',
          note: 'Submitted again via OTHER',
        }),
      });
    });

    // SCRUM-29: a differently-worded `course` used to bypass dedup entirely and create a
    // second record for a phone/email that already existed — same phone/email is always
    // a duplicate now, regardless of course.
    it('rejects as a duplicate even when the resubmission has a different course', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue({ ...mockLead, course: 'MBA' });
      await expect(
        service.create({ name: 'John', phone: '9999999999', course: 'MCA', source: LeadSource.OTHER }, repUser),
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.lead.update).toHaveBeenCalledWith({
        where: { id: 'lead-1' },
        data: { activityAt: expect.any(Date) },
      });
      expect(mockPrisma.lead.create).not.toHaveBeenCalled();
    });

    it('auto-creates a course when the lead names one', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.create.mockResolvedValue({ ...mockLead, course: 'Business English', name: 'Fatima Sheikh' });
      await service.create(
        { name: 'Fatima Sheikh', phone: '9999999999', course: 'Business English', source: LeadSource.OTHER },
        repUser,
      );
      expect(mockCourses.ensureCourseFromLead).toHaveBeenCalledWith('Business English', 'Fatima Sheikh', 'org-1');
    });

    it('does not attempt course auto-create when the lead has no course', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.create.mockResolvedValue(mockLead);
      await service.create({ name: 'John', phone: '9999999999', source: LeadSource.OTHER }, repUser);
      expect(mockCourses.ensureCourseFromLead).not.toHaveBeenCalled();
    });

    it('does not let a course auto-create failure block lead creation', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.create.mockResolvedValue({ ...mockLead, course: 'Business English' });
      mockCourses.ensureCourseFromLead.mockRejectedValueOnce(new Error('db hiccup'));
      const result = await service.create(
        { name: 'John', phone: '9999999999', course: 'Business English', source: LeadSource.OTHER },
        repUser,
      );
      expect(result).toEqual(expect.objectContaining({ id: 'lead-1' }));
    });

    it('creates lead with normalized phone truncated to last 10 digits when no duplicate', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.create.mockResolvedValue(mockLead);
      const result = await service.create(
        { name: 'John', phone: '+91 99999 99999', source: LeadSource.OTHER },
        repUser,
      );
      expect(mockPrisma.lead.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ phone: '9999999999' }) }),
      );
      expect(result).toEqual(mockLead);
    });

    it('normalizes email to lowercase on create', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.create.mockResolvedValue(mockLead);
      await service.create(
        { name: 'John', phone: '9999999999', email: 'JOHN@EXAMPLE.COM', source: LeadSource.OTHER },
        repUser,
      );
      expect(mockPrisma.lead.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ email: 'john@example.com' }) }),
      );
    });

    it('trims and collapses internal whitespace in the name on create', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.create.mockResolvedValue(mockLead);
      await service.create({ name: '  John   Doe  ', phone: '9999999999', source: LeadSource.OTHER }, repUser);
      expect(mockPrisma.lead.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ name: 'John Doe' }) }),
      );
    });

    it('sets teamId from caller on create', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.create.mockResolvedValue(mockLead);
      await service.create({ name: 'John', phone: '9999999999', source: LeadSource.OTHER }, repUser);
      expect(mockPrisma.lead.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ teamId: 'team-1' }) }),
      );
    });

    it('auto-enrolls the new lead into lead_created nurturing sequences', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.create.mockResolvedValue(mockLead);
      await service.create({ name: 'John', phone: '9999999999', source: LeadSource.OTHER }, repUser);
      expect(mockNurturing.autoEnroll).toHaveBeenCalledWith(
        mockLead.id,
        mockLead.orgId,
        'lead_created',
        undefined,
        true,
      );
    });
  });

  describe('importLeads', () => {
    const row = (phone: string) => ({ name: 'Test', phone, source: LeadSource.OTHER });

    it('returns correct counts when all rows succeed', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.create.mockResolvedValue(mockLead);
      const result = await service.importLeads([row('1111111111'), row('2222222222'), row('3333333333')], repUser);
      expect(result).toEqual({ total: 3, imported: 3, skipped: 0, errors: [], warnings: [] });
    });

    it('defers nurturing sends for imported rows so they are spread across ticks', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.create.mockResolvedValue(mockLead);
      await service.importLeads([row('1111111111')], repUser);
      expect(mockNurturing.autoEnroll).toHaveBeenCalledWith(
        mockLead.id,
        mockLead.orgId,
        'lead_created',
        undefined,
        false,
      );
    });

    it('truncates an over-length name to 100 chars, imports the row, and reports it as a warning (not skipped)', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.create.mockResolvedValue(mockLead);
      const longName = 'A'.repeat(150);
      const result = await service.importLeads(
        [{ name: longName, phone: '1111111111', source: LeadSource.OTHER }],
        repUser,
      );
      expect(result).toMatchObject({ total: 1, imported: 1, skipped: 0 });
      expect(result.warnings).toEqual([{ row: 1, reason: 'name truncated to 100 characters' }]);
      expect(mockPrisma.lead.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ name: 'A'.repeat(100) }) }),
      );
    });

    it('truncates an over-length phone to the last 10 digits, imports the row, and reports it as a warning (not skipped)', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.create.mockResolvedValue(mockLead);
      const result = await service.importLeads([row('98765432101234')], repUser);
      expect(result).toMatchObject({ total: 1, imported: 1, skipped: 0 });
      expect(result.warnings).toEqual([{ row: 1, reason: 'phone number truncated to last 10 digits' }]);
      expect(mockPrisma.lead.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ phone: '5432101234' }) }),
      );
    });

    it('skips a row whose phone has fewer than 10 digits and reports the reason', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      const result = await service.importLeads([row('99999')], repUser);
      expect(result).toMatchObject({ total: 1, imported: 0, skipped: 1 });
      expect(result.errors).toEqual([{ row: 1, reason: ErrorMessages.leads.invalidPhone }]);
      expect(mockPrisma.lead.create).not.toHaveBeenCalled();
    });

    it('skips a row with a malformed email and reports the reason', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      const result = await service.importLeads(
        [{ name: 'Test', phone: '1111111111', email: 'not-an-email', source: LeadSource.OTHER }],
        repUser,
      );
      expect(result).toMatchObject({ total: 1, imported: 0, skipped: 1 });
      expect(result.errors).toEqual([{ row: 1, reason: ErrorMessages.leads.invalidEmail }]);
      expect(mockPrisma.lead.create).not.toHaveBeenCalled();
    });

    it('skips a row whose email domain repeats a segment (e.g. .com.com)', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      const result = await service.importLeads(
        [{ name: 'Test', phone: '1111111111', email: 'sklsd@sdf.com.com.com', source: LeadSource.OTHER }],
        repUser,
      );
      expect(result).toMatchObject({ total: 1, imported: 0, skipped: 1 });
      expect(result.errors).toEqual([{ row: 1, reason: ErrorMessages.leads.invalidEmail }]);
      expect(mockPrisma.lead.create).not.toHaveBeenCalled();
    });

    it('drops a malformed altEmail, imports the row, and reports it as a warning (not skipped)', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.create.mockResolvedValue(mockLead);
      const result = await service.importLeads(
        [{ name: 'Test', phone: '1111111111', altEmail: 'not-an-email', source: LeadSource.OTHER }],
        repUser,
      );
      expect(result).toMatchObject({ total: 1, imported: 1, skipped: 0 });
      expect(result.warnings).toEqual([{ row: 1, reason: 'alt email invalid — dropped' }]);
      expect(mockPrisma.lead.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ altEmail: undefined }) }),
      );
    });

    it('counts duplicate rows as skipped with reason "Duplicate lead"', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(mockLead);
      const result = await service.importLeads([row('9999999999'), row('9999999999')], repUser);
      expect(result).toMatchObject({ total: 2, imported: 0, skipped: 2 });
      expect(result.errors[0]).toEqual({ row: 1, reason: ErrorMessages.leads.duplicate });
      expect(result.errors[1]).toEqual({ row: 2, reason: ErrorMessages.leads.duplicate });
    });

    it('handles mixed rows — success, duplicate, success', async () => {
      mockPrisma.lead.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(mockLead).mockResolvedValueOnce(null);
      mockPrisma.lead.create.mockResolvedValue(mockLead);
      const result = await service.importLeads([row('1111111111'), row('9999999999'), row('2222222222')], repUser);
      expect(result).toMatchObject({ total: 3, imported: 2, skipped: 1 });
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toEqual({ row: 2, reason: ErrorMessages.leads.duplicate });
    });

    it('continues importing after a failure and includes error row number', async () => {
      mockPrisma.lead.findFirst.mockResolvedValueOnce(mockLead).mockResolvedValueOnce(null);
      mockPrisma.lead.create.mockResolvedValue(mockLead);
      const result = await service.importLeads([row('9999999999'), row('1111111111')], repUser);
      expect(result).toMatchObject({ total: 2, imported: 1, skipped: 1 });
      expect(result.errors[0].row).toBe(1);
    });

    it('returns empty result for empty input', async () => {
      const result = await service.importLeads([], repUser);
      expect(result).toEqual({ total: 0, imported: 0, skipped: 0, errors: [], warnings: [] });
    });
  });

  describe('findAll', () => {
    it('findAll with customStageIds filters where customStageId in', async () => {
      mockPrisma.lead.count.mockResolvedValue(0);
      mockPrisma.lead.findMany.mockResolvedValue([]);
      await service.findAll({ customStageIds: ['cs-1'] }, directorUser);
      expect(mockPrisma.lead.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ orgId: 'org-1', customStageId: { in: ['cs-1'] } }),
        }),
      );
    });

    beforeEach(() => {
      mockPrisma.lead.count.mockResolvedValue(0);
      mockPrisma.lead.findMany.mockResolvedValue([]);
    });

    it('scopes query to assignedToId for SALES_REP', async () => {
      await service.findAll({}, repUser);
      expect(mockPrisma.lead.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ assignedToId: 'rep-1' }) }),
      );
    });

    it('scopes query to teamId for MANAGER', async () => {
      await service.findAll({}, managerUser);
      expect(mockPrisma.lead.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ teamId: 'team-1' }) }),
      );
    });

    it('does not add user scope filter for DIRECTOR', async () => {
      await service.findAll({}, directorUser);
      const call = mockPrisma.lead.findMany.mock.calls[0][0] as { where: Record<string, unknown> };
      expect(call.where).not.toHaveProperty('assignedToId');
      expect(call.where).not.toHaveProperty('teamId');
    });

    it('filters by teamIds array with an `in` clause for DIRECTOR', async () => {
      await service.findAll({ teamIds: ['team-1', 'team-2'] }, directorUser);
      expect(mockPrisma.lead.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ teamId: { in: ['team-1', 'team-2'] } }),
        }),
      );
    });

    it('prefers the plural teamIds array over the singular teamId when both are present', async () => {
      await service.findAll({ teamId: 'team-3', teamIds: ['team-1', 'team-2'] }, directorUser);
      expect(mockPrisma.lead.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ teamId: { in: ['team-1', 'team-2'] } }),
        }),
      );
    });

    it('falls back to the singular teamId for DIRECTOR when teamIds is absent', async () => {
      await service.findAll({ teamId: 'team-1' }, directorUser);
      expect(mockPrisma.lead.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ teamId: 'team-1' }) }),
      );
    });

    it('ignores the team filter for MANAGER (already scoped to their own team)', async () => {
      await service.findAll({ teamIds: ['team-1', 'team-2'] }, managerUser);
      expect(mockPrisma.lead.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ teamId: 'team-1' }) }),
      );
    });

    it('includes orgId in scope for SALES_REP', async () => {
      await service.findAll({}, repUser);
      expect(mockPrisma.lead.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1' }) }),
      );
    });

    it('includes orgId in scope for MANAGER', async () => {
      await service.findAll({}, managerUser);
      expect(mockPrisma.lead.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1' }) }),
      );
    });

    it('includes orgId in scope for DIRECTOR', async () => {
      await service.findAll({}, directorUser);
      expect(mockPrisma.lead.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1' }) }),
      );
    });

    it('returns paginated response shape', async () => {
      mockPrisma.lead.count.mockResolvedValue(5);
      mockPrisma.lead.findMany.mockResolvedValue([mockLead]);
      const result = await service.findAll({ page: 1, limit: 10 }, directorUser);
      expect(result).toMatchObject({ data: [mockLead], total: 5, page: 1, limit: 10, pages: 1 });
    });

    // A lead created before the range but last updated within it (e.g. enrolled this
    // month after being created last month) must still match — see buildListWhere().
    it('filters by createdAt >= createdAfter OR updatedAt >= createdAfter when provided', async () => {
      const createdAfter = '2026-06-25T00:00:00.000Z';
      await service.findAll({ createdAfter }, directorUser);
      const dateFilter = { gte: new Date(createdAfter) };
      expect(mockPrisma.lead.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([leadInRange(dateFilter)]),
          }),
        }),
      );
    });

    it('dateField=created filters strictly on createdAt', async () => {
      const createdAfter = '2026-06-25T00:00:00.000Z';
      await service.findAll({ createdAfter, dateField: 'created' }, directorUser);
      expect(mockPrisma.lead.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ AND: [{ createdAt: { gte: new Date(createdAfter) } }] }),
        }),
      );
    });

    it('dateField=updated filters on real activity/messages, never on Lead.updatedAt', async () => {
      const createdAfter = '2026-06-25T00:00:00.000Z';
      await service.findAll({ createdAfter, dateField: 'updated' }, directorUser);
      expect(mockPrisma.lead.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: [leadActivityInRange({ gte: new Date(createdAfter) })],
          }),
        }),
      );
      expect(JSON.stringify(mockPrisma.lead.findMany.mock.calls[0][0])).not.toContain('updatedAt');
    });

    it('does not add a date AND-group when createdAfter is invalid', async () => {
      await service.findAll({ createdAfter: 'not-a-date' }, directorUser);
      const call = mockPrisma.lead.findMany.mock.calls[0][0] as { where: Record<string, unknown> };
      expect(call.where).not.toHaveProperty('AND');
    });

    it('defaults to sorting by createdAt desc when sortBy is not provided', async () => {
      await service.findAll({}, directorUser);
      expect(mockPrisma.lead.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
      );
    });

    it('never returns the stored raw form answers to the client', async () => {
      mockPrisma.lead.findMany.mockResolvedValue([{ id: 'l1', name: 'A', rawFields: { phone: '999' } }]);
      const res = await service.findAll({}, directorUser);
      expect(res.data[0]).not.toHaveProperty('rawFields');
      expect(res.data[0]).toHaveProperty('name', 'A');
    });

    it('sorts by a whitelisted column in the requested direction', async () => {
      await service.findAll({ sortBy: 'score', sortOrder: 'asc' }, directorUser);
      expect(mockPrisma.lead.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { score: 'asc' } }));
    });

    it('sorts the owner column through the assignedTo relation', async () => {
      await service.findAll({ sortBy: 'owner', sortOrder: 'asc' }, directorUser);
      expect(mockPrisma.lead.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { assignedTo: { name: 'asc' } } }),
      );
    });

    it('falls back to createdAt when sortBy is not a sortable column', async () => {
      await service.findAll({ sortBy: 'customFields', sortOrder: 'asc' }, directorUser);
      expect(mockPrisma.lead.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { createdAt: 'asc' } }));
    });

    it('filters by stages array with an `in` clause', async () => {
      await service.findAll({ stages: [LeadStage.NEW, LeadStage.CONTACTED] }, directorUser);
      expect(mockPrisma.lead.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ stage: { in: [LeadStage.NEW, LeadStage.CONTACTED] } }),
        }),
      );
    });

    it('prefers the plural sources array over the singular source when both are present', async () => {
      await service.findAll(
        { source: LeadSource.WEBSITE, sources: [LeadSource.INSTAGRAM, LeadSource.FACEBOOK] },
        directorUser,
      );
      expect(mockPrisma.lead.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ source: { in: [LeadSource.INSTAGRAM, LeadSource.FACEBOOK] } }),
        }),
      );
    });

    it('filters by cities (location column) with an `in` clause', async () => {
      await service.findAll({ cities: ['Bangalore', 'Pune'] }, directorUser);
      expect(mockPrisma.lead.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ location: { in: ['Bangalore', 'Pune'] } }),
        }),
      );
    });

    it('filters by score range', async () => {
      await service.findAll({ scoreMin: 70, scoreMax: 90 }, directorUser);
      expect(mockPrisma.lead.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ score: { gte: 70, lte: 90 } }) }),
      );
    });

    it('applies createdBefore alongside createdAfter as a single createdAt/updatedAt range', async () => {
      const createdAfter = '2026-06-01T00:00:00.000Z';
      const createdBefore = '2026-06-30T00:00:00.000Z';
      await service.findAll({ createdAfter, createdBefore }, directorUser);
      const dateFilter = { gte: new Date(createdAfter), lt: new Date(createdBefore) };
      expect(mockPrisma.lead.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([leadInRange(dateFilter)]),
          }),
        }),
      );
    });

    it('treats a date-only createdBefore as through the end of that day, not its start', async () => {
      await service.findAll({ createdBefore: '2026-08-08' }, directorUser);
      const dateFilter = { lt: new Date('2026-08-09') };
      expect(mockPrisma.lead.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([leadInRange(dateFilter)]),
          }),
        }),
      );
    });

    it('combines hotOnly and search as independent AND-ed OR-groups, not a clobbered single OR', async () => {
      await service.findAll({ search: 'sneha', hotOnly: true }, directorUser);
      const call = mockPrisma.lead.findMany.mock.calls[0][0] as { where: Record<string, unknown> };
      expect(call.where.AND).toEqual([
        {
          OR: [
            { name: { contains: 'sneha', mode: 'insensitive' } },
            { phone: { contains: 'sneha' } },
            { email: { contains: 'sneha', mode: 'insensitive' } },
          ],
        },
        { OR: [{ score: { gte: 85 } }, { tags: { has: 'hot-lead' } }] },
      ]);
    });

    it('does not apply assignedToIds scoping for SALES_REP (own-leads scope already applies)', async () => {
      await service.findAll({ assignedToIds: ['other-rep'] }, repUser);
      expect(mockPrisma.lead.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ assignedToId: 'rep-1' }) }),
      );
    });

    it('filters by notEngaged quick filter (score < 10), mirroring reports.productivity', async () => {
      await service.findAll({ notEngaged: true }, directorUser);
      const call = mockPrisma.lead.findMany.mock.calls[0][0] as { where: Record<string, unknown> };
      expect(call.where.AND).toContainEqual({ score: { lt: 10 } });
    });

    it('filters by untouched quick filter (no genuine activities), mirroring reports.productivity', async () => {
      await service.findAll({ untouched: true }, directorUser);
      const call = mockPrisma.lead.findMany.mock.calls[0][0] as { where: Record<string, unknown> };
      expect(call.where.AND).toContainEqual({
        activities: { none: { type: { notIn: SYSTEM_ACTIVITY_TYPES } } },
      });
    });

    it('filters by followupOverdue quick filter (stage not closed), mirroring reports.productivity', async () => {
      await service.findAll({ followupOverdue: true }, directorUser);
      const call = mockPrisma.lead.findMany.mock.calls[0][0] as { where: Record<string, unknown> };
      expect(call.where.AND).toContainEqual({
        stage: { notIn: [LeadStage.CLOSED_WON, LeadStage.CLOSED_LOST, LeadStage.NOT_INTERESTED] },
      });
    });

    it('filters by leaking quick filter as active-rep leads that are untouched OR still open, mirroring reports.productivity', async () => {
      await service.findAll({ leaking: true }, directorUser);
      const call = mockPrisma.lead.findMany.mock.calls[0][0] as {
        where: { AND: { assignedTo?: unknown; OR?: unknown[] }[] };
      };
      const group = call.where.AND.find((g) => g.OR);
      expect(group?.assignedTo).toEqual({ is: { role: Role.SALES_REP, isActive: true } });
      expect(group?.OR).toHaveLength(2);
    });

    it('filters by idle quick filter (no activity in the last 24h), for the Saved views "Idle 24h+" pill', async () => {
      await service.findAll({ idle: true }, directorUser);
      const call = mockPrisma.lead.findMany.mock.calls[0][0] as {
        where: { AND: { activities?: { none?: { createdAt?: { gte: Date } } } }[] };
      };
      const group = call.where.AND.find((g) => g.activities?.none?.createdAt);
      expect(group).toBeDefined();
      const since = group?.activities?.none?.createdAt?.gte;
      expect(since).toBeInstanceOf(Date);
      expect(Date.now() - (since as Date).getTime()).toBeCloseTo(24 * 60 * 60 * 1000, -3);
    });

    it('filters by commsAfter/commsBefore (communication sentAt range), mirroring reports.dailySummary contacted', async () => {
      const commsAfter = '2026-06-01T00:00:00.000Z';
      const commsBefore = '2026-06-30T00:00:00.000Z';
      await service.findAll({ commsAfter, commsBefore }, directorUser);
      const call = mockPrisma.lead.findMany.mock.calls[0][0] as { where: Record<string, unknown> };
      expect(call.where.AND).toContainEqual({
        communications: {
          some: { sentAt: { gte: new Date(commsAfter), lt: new Date(commsBefore) } },
        },
      });
    });

    it('treats a date-only commsBefore as through the end of that day, not its start', async () => {
      await service.findAll({ commsBefore: '2026-08-08' }, directorUser);
      const call = mockPrisma.lead.findMany.mock.calls[0][0] as { where: Record<string, unknown> };
      expect(call.where.AND).toContainEqual({
        communications: { some: { sentAt: { lt: new Date('2026-08-09') } } },
      });
    });

    it('filters by pendingFollowup quick filter, mirroring reports.dailySummary pending', async () => {
      await service.findAll({ pendingFollowup: true }, directorUser);
      const call = mockPrisma.lead.findMany.mock.calls[0][0] as { where: Record<string, unknown> };
      expect(call.where.AND).toContainEqual({
        stage: LeadStage.NEW,
        assignedToId: { not: null },
        communications: { none: {} },
      });
    });
  });

  describe('getRecent', () => {
    beforeEach(() => {
      mockPrisma.lead.count.mockResolvedValue(0);
      mockPrisma.lead.findMany.mockResolvedValue([]);
    });

    it('returns { count, leads } shape', async () => {
      mockPrisma.lead.count.mockResolvedValue(2);
      mockPrisma.lead.findMany.mockResolvedValue([mockLead]);
      const result = await service.getRecent('2026-06-25T00:00:00.000Z', directorUser);
      expect(result).toEqual({ count: 2, leads: [mockLead] });
    });

    it('scopes to orgId and filters by activityAt > since', async () => {
      const since = '2026-06-25T00:00:00.000Z';
      await service.getRecent(since, directorUser);
      expect(mockPrisma.lead.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            orgId: 'org-1',
            isDeleted: false,
            activityAt: { gt: new Date(since) },
          }),
        }),
      );
    });

    it('maps activityAt to updatedAt in the returned leads (API contract)', async () => {
      const activityAt = new Date('2026-06-26T00:00:00.000Z');
      mockPrisma.lead.findMany.mockResolvedValue([{ ...mockLead, activityAt }]);
      const result = await service.getRecent('2026-06-25T00:00:00.000Z', directorUser);
      expect(result.leads[0]).toMatchObject({ updatedAt: activityAt });
      expect(result.leads[0]).not.toHaveProperty('activityAt');
    });

    it('scopes to assignedToId for SALES_REP', async () => {
      await service.getRecent('2026-06-25T00:00:00.000Z', repUser);
      expect(mockPrisma.lead.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ assignedToId: 'rep-1' }) }),
      );
    });
  });

  describe('findOne', () => {
    beforeEach(() => {
      mockPrisma.communication.count.mockResolvedValue(0);
    });

    it('throws NotFoundException when lead does not exist', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      await expect(service.findOne('bad-id', repUser)).rejects.toThrow(NotFoundException);
    });

    it("throws NotFoundException when SALES_REP accesses another rep's lead", async () => {
      mockPrisma.lead.findFirst.mockResolvedValue({ ...mockLead, assignedToId: 'other-rep' });
      await expect(service.findOne('lead-1', repUser)).rejects.toThrow(NotFoundException);
    });

    it("throws NotFoundException when MANAGER accesses a different team's lead", async () => {
      mockPrisma.lead.findFirst.mockResolvedValue({ ...mockLead, teamId: 'other-team' });
      await expect(service.findOne('lead-1', managerUser)).rejects.toThrow(NotFoundException);
    });

    it('returns lead for valid access', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(mockLead);
      mockPrisma.user.findFirst.mockResolvedValue(null);
      const result = await service.findOne('lead-1', repUser);
      expect(result).toMatchObject(mockLead);
    });

    it('builds assignmentChain.owner from assignedTo and .manager from team.manager', async () => {
      const leadWithChainData = {
        ...mockLead,
        assignedTo: { id: 'rep-1', name: 'Rep One', role: Role.SALES_REP },
        team: { id: 'team-1', name: 'Team A', manager: { id: 'mgr-1', name: 'Manager' } },
      };
      mockPrisma.lead.findFirst.mockResolvedValue(leadWithChainData);
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'dir-1', name: 'Director' });
      const result = await service.findOne('lead-1', repUser);
      expect(result.assignmentChain).toEqual({
        owner: { id: 'rep-1', name: 'Rep One', role: Role.SALES_REP },
        manager: { id: 'mgr-1', name: 'Manager' },
        director: { id: 'dir-1', name: 'Director' },
      });
    });

    it('resolves assignmentChain.director via a findFirst scoped to caller.orgId and role=DIRECTOR', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(mockLead);
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'dir-1', name: 'Director' });
      await service.findOne('lead-1', repUser);
      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { orgId: 'org-1', role: Role.DIRECTOR } }),
      );
    });

    it('sets assignmentChain.manager and .director to null when there is no team / no director in the org', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue({ ...mockLead, assignedTo: null, team: null });
      mockPrisma.user.findFirst.mockResolvedValue(null);
      const result = await service.findOne('lead-1', repUser);
      expect(result.assignmentChain).toEqual({ owner: null, manager: null, director: null });
    });

    it('sets whatsappConversationOpen false when the lead has never replied on WhatsApp', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(mockLead);
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.communication.count.mockResolvedValue(0);
      const result = await service.findOne('lead-1', repUser);
      expect(result.whatsappConversationOpen).toBe(false);
    });

    it('sets whatsappConversationOpen true once the lead has replied on WhatsApp, scoped to inbound messages for this lead', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(mockLead);
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.communication.count.mockResolvedValue(1);
      const result = await service.findOne('lead-1', repUser);
      expect(result.whatsappConversationOpen).toBe(true);
      expect(mockPrisma.communication.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            leadId: 'lead-1',
            type: 'WHATSAPP',
            direction: 'inbound',
            sentAt: { gte: expect.any(Date) },
          },
        }),
      );
    });

    it('does NOT unlock free-form from our own outbound sends (template or free-form) — only an inbound reply counts', async () => {
      // Regression test for SCRUM-50: the original heuristic counted our own outbound
      // sent/delivered/read messages, which let free-form be attempted (and fail with
      // Meta's 131047 "re-engagement message" error) even when the customer never replied.
      mockPrisma.lead.findFirst.mockResolvedValue(mockLead);
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.communication.count.mockResolvedValue(0);
      await service.findOne('lead-1', repUser);
      expect(mockPrisma.communication.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ direction: 'inbound' }),
        }),
      );
      expect(mockPrisma.communication.count).not.toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: expect.anything() }),
        }),
      );
    });

    it('scopes the whatsappConversationOpen window to the last 24h, so a stale send re-locks free-form', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(mockLead);
      mockPrisma.user.findFirst.mockResolvedValue(null);
      // A message older than 24h no longer satisfies the query in production; here we assert
      // the query itself is time-bound rather than relying on Prisma's own filtering.
      mockPrisma.communication.count.mockResolvedValue(0);
      await service.findOne('lead-1', repUser);
      const call = mockPrisma.communication.count.mock.calls.at(-1)?.[0];
      const gte = call.where.sentAt.gte as Date;
      const ageMs = Date.now() - gte.getTime();
      expect(ageMs).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000 - 1000);
      expect(ageMs).toBeLessThan(24 * 60 * 60 * 1000 + 5000);
    });
  });

  describe('follow-ups', () => {
    it('lists open scheduled follow-ups scoped to org and the rep', async () => {
      mockPrisma.lead.findMany.mockResolvedValue([]);
      await service.findFollowUps(repUser);
      expect(mockPrisma.lead.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            orgId: 'org-1',
            assignedToId: repUser.id,
            isDeleted: false,
            followUpAt: expect.objectContaining({ not: null }),
          }),
        }),
      );
    });

    it('schedules a follow-up from an ISO date', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(mockLead);
      mockPrisma.lead.update.mockResolvedValue(mockLead);
      mockPrisma.activity.create.mockResolvedValue({});
      mockPrisma.organization.findUnique.mockResolvedValue({ timezone: 'Asia/Kolkata' });
      await service.update('lead-1', { followUpAt: '2026-11-20T09:00:00.000Z', followUpNote: 'Call back' }, repUser);
      expect(mockPrisma.lead.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            followUpAt: new Date('2026-11-20T09:00:00.000Z'),
            followUpNote: 'Call back',
          }),
        }),
      );
      // Its own timeline entry, not a "stage change"
      expect(mockPrisma.activity.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'FOLLOW_UP_SCHEDULED',
          note: expect.stringContaining('Follow-up scheduled for'),
        }),
      });
    });

    it('clears the follow-up date and note when marked done', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(mockLead);
      mockPrisma.lead.update.mockResolvedValue(mockLead);
      mockPrisma.activity.create.mockResolvedValue({});
      await service.update('lead-1', { followUpAt: null }, repUser);
      expect(mockPrisma.lead.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ followUpAt: null, followUpNote: null }) }),
      );
      expect(mockPrisma.activity.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ type: 'FOLLOW_UP_DONE', note: 'Follow-up marked done' }),
      });
    });
  });

  describe('update', () => {
    const customStage = {
      id: 'cs-1',
      orgId: 'org-1',
      label: 'Demo Booked',
      baseStage: null,
      countsAs: LeadStage.INTERESTED,
    };
    const setupCustom = (countsAs: LeadStage) => {
      mockPrisma.lead.findFirst.mockResolvedValue({ ...mockLead, stage: LeadStage.CONTACTED });
      mockPrisma.stageConfig.findFirst.mockResolvedValue({ ...customStage, countsAs });
      mockPrisma.lead.update.mockResolvedValue(mockLead);
      mockPrisma.activity.create.mockResolvedValue({});
    };
    const updateData = () => (mockPrisma.lead.update.mock.calls[0][0] as { data: Record<string, unknown> }).data;

    it('update with customStageId sets stage to countsAs and customStageId together', async () => {
      setupCustom(LeadStage.INTERESTED);
      await service.update('lead-1', { customStageId: 'cs-1' }, repUser);
      expect(updateData()).toEqual(
        expect.objectContaining({ stage: LeadStage.INTERESTED, customStage: { connect: { id: 'cs-1' } } }),
      );
      expect(mockPrisma.activity.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ note: 'Stage changed to Demo Booked' }) }),
      );
    });

    it('update with customStageId looks the stage up scoped by orgId', async () => {
      setupCustom(LeadStage.INTERESTED);
      await service.update('lead-1', { customStageId: 'cs-1' }, repUser);
      expect(mockPrisma.stageConfig.findFirst).toHaveBeenCalledWith({
        where: { id: 'cs-1', orgId: 'org-1', baseStage: null },
      });
    });

    it('update with unknown/other-org customStageId throws NotFoundException', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(mockLead);
      mockPrisma.stageConfig.findFirst.mockResolvedValue(null);
      await expect(service.update('lead-1', { customStageId: 'nope' }, repUser)).rejects.toThrow(NotFoundException);
      expect(mockPrisma.lead.update).not.toHaveBeenCalled();
    });

    it('update with built-in stage only clears customStageId to null', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(mockLead);
      mockPrisma.lead.update.mockResolvedValue(mockLead);
      mockPrisma.activity.create.mockResolvedValue({});
      await service.update('lead-1', { stage: LeadStage.CONTACTED }, repUser);
      expect(updateData()).toEqual(
        expect.objectContaining({ stage: LeadStage.CONTACTED, customStage: { disconnect: true } }),
      );
      expect(mockPrisma.stageConfig.findFirst).not.toHaveBeenCalled();
    });

    it('custom stage mapped to NOT_INTERESTED sets notInterestedAt', async () => {
      setupCustom(LeadStage.NOT_INTERESTED);
      await service.update('lead-1', { customStageId: 'cs-1' }, repUser);
      expect(updateData()).toEqual(expect.objectContaining({ notInterestedAt: expect.any(Date) }));
    });

    it('custom stage mapped to INTERESTED increments interestedCount', async () => {
      setupCustom(LeadStage.INTERESTED);
      await service.update('lead-1', { customStageId: 'cs-1' }, repUser);
      expect(updateData()).toEqual(expect.objectContaining({ interestedCount: { increment: 1 } }));
    });

    it('sets notInterestedAt when stage is NOT_INTERESTED', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(mockLead);
      mockPrisma.lead.update.mockResolvedValue({ ...mockLead, stage: LeadStage.NOT_INTERESTED });
      mockPrisma.activity.create.mockResolvedValue({});
      await service.update('lead-1', { stage: LeadStage.NOT_INTERESTED }, repUser);
      expect(mockPrisma.lead.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ notInterestedAt: expect.any(Date) }) }),
      );
    });

    it('does not set notInterestedAt for other stage transitions', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(mockLead);
      mockPrisma.lead.update.mockResolvedValue(mockLead);
      mockPrisma.activity.create.mockResolvedValue({});
      await service.update('lead-1', { stage: LeadStage.CONTACTED }, repUser);
      const data = (mockPrisma.lead.update.mock.calls[0][0] as { data: Record<string, unknown> }).data;
      expect(data).not.toHaveProperty('notInterestedAt');
    });

    it('bumps the lead engagement score on a genuine stage change', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(mockLead);
      mockPrisma.lead.update.mockResolvedValue(mockLead);
      mockPrisma.activity.create.mockResolvedValue({});
      await service.update('lead-1', { stage: LeadStage.CONTACTED }, repUser);
      expect(mockPrisma.$executeRaw).toHaveBeenCalled();
    });

    it('does not bump the score when the stage is unchanged', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue({ ...mockLead, stage: LeadStage.INTERESTED });
      mockPrisma.lead.update.mockResolvedValue({ ...mockLead, stage: LeadStage.INTERESTED });
      mockPrisma.activity.create.mockResolvedValue({});
      await service.update('lead-1', { stage: LeadStage.INTERESTED }, repUser);
      expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
    });

    it('normalizes altEmail to lowercase/trimmed on update', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(mockLead);
      mockPrisma.lead.update.mockResolvedValue(mockLead);
      mockPrisma.activity.create.mockResolvedValue({});
      await service.update('lead-1', { altEmail: '  Alt@Example.com  ' }, repUser);
      expect(mockPrisma.lead.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ altEmail: 'alt@example.com' }) }),
      );
    });

    it('increments interestedCount on a fresh transition into INTERESTED', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue({ ...mockLead, stage: LeadStage.CONTACTED });
      mockPrisma.lead.update.mockResolvedValue({ ...mockLead, stage: LeadStage.INTERESTED });
      mockPrisma.activity.create.mockResolvedValue({});
      await service.update('lead-1', { stage: LeadStage.INTERESTED }, repUser);
      expect(mockPrisma.lead.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ interestedCount: { increment: 1 } }) }),
      );
    });

    it('does not increment interestedCount when already INTERESTED', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue({ ...mockLead, stage: LeadStage.INTERESTED });
      mockPrisma.lead.update.mockResolvedValue({ ...mockLead, stage: LeadStage.INTERESTED });
      mockPrisma.activity.create.mockResolvedValue({});
      await service.update('lead-1', { stage: LeadStage.INTERESTED }, repUser);
      const data = (mockPrisma.lead.update.mock.calls[0][0] as { data: Record<string, unknown> }).data;
      expect(data).not.toHaveProperty('interestedCount');
    });

    it('does not increment interestedCount for non-INTERESTED transitions', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue({ ...mockLead, stage: LeadStage.NEW });
      mockPrisma.lead.update.mockResolvedValue({ ...mockLead, stage: LeadStage.CONTACTED });
      mockPrisma.activity.create.mockResolvedValue({});
      await service.update('lead-1', { stage: LeadStage.CONTACTED }, repUser);
      const data = (mockPrisma.lead.update.mock.calls[0][0] as { data: Record<string, unknown> }).data;
      expect(data).not.toHaveProperty('interestedCount');
    });

    it('auto-enrolls with the new stage on a stage_change trigger', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(mockLead);
      mockPrisma.lead.update.mockResolvedValue({ ...mockLead, stage: LeadStage.CONTACTED });
      mockPrisma.activity.create.mockResolvedValue({});
      await service.update('lead-1', { stage: LeadStage.CONTACTED }, repUser);
      expect(mockNurturing.autoEnroll).toHaveBeenCalledWith(
        mockLead.id,
        mockLead.orgId,
        'stage_change',
        LeadStage.CONTACTED,
      );
    });

    it('clears assignedToId and logs a REASSIGN activity when assignedToId: null is sent', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue({
        ...mockLead,
        assignedTo: { id: 'rep-1', name: 'Rep One', role: 'SALES_REP' },
      });
      mockPrisma.lead.update.mockResolvedValue({ ...mockLead, assignedToId: null });
      mockPrisma.activity.create.mockResolvedValue({});
      await service.update('lead-1', { assignedToId: null }, managerUser);
      expect(mockPrisma.lead.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ assignedToId: null }) }),
      );
      expect(mockPrisma.activity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'REASSIGN', note: expect.stringContaining('Unassigned') }),
        }),
      );
    });

    it('trims and collapses internal whitespace in the name on update', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(mockLead);
      mockPrisma.lead.update.mockResolvedValue(mockLead);
      mockPrisma.activity.create.mockResolvedValue({});
      await service.update('lead-1', { name: '  Jane   Doe  ' }, repUser);
      expect(mockPrisma.lead.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ name: 'Jane Doe' }) }),
      );
    });

    it('does not touch assignedToId when it is omitted from the patch', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(mockLead);
      mockPrisma.lead.update.mockResolvedValue(mockLead);
      mockPrisma.activity.create.mockResolvedValue({});
      await service.update('lead-1', { stage: LeadStage.CONTACTED }, repUser);
      const data = (mockPrisma.lead.update.mock.calls[0][0] as { data: Record<string, unknown> }).data;
      expect(data).not.toHaveProperty('assignedToId');
    });
  });

  describe('softDelete', () => {
    it('sets isDeleted true without hard deleting', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(mockLead);
      mockPrisma.lead.update.mockResolvedValue({ ...mockLead, isDeleted: true });
      await service.softDelete('lead-1', repUser);
      expect(mockPrisma.lead.update).toHaveBeenCalledWith({ where: { id: 'lead-1' }, data: { isDeleted: true } });
    });
  });

  describe('archiveMany', () => {
    it('returns archived: 0 without calling Prisma for empty input', async () => {
      const result = await service.archiveMany([], managerUser);
      expect(result).toEqual({ archived: 0 });
      expect(mockPrisma.lead.updateMany).not.toHaveBeenCalled();
    });

    it('scopes updateMany to orgId + isDeleted false and sets isDeleted true', async () => {
      mockPrisma.lead.updateMany.mockResolvedValue({ count: 2 });
      const result = await service.archiveMany(['lead-1', 'lead-2'], managerUser);
      expect(mockPrisma.lead.updateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          id: { in: ['lead-1', 'lead-2'] },
          isDeleted: false,
          orgId: 'org-1',
          teamId: 'team-1',
        }),
        data: { isDeleted: true },
      });
      expect(result).toEqual({ archived: 2 });
    });
  });

  describe('archiveAllMatching', () => {
    it('archives every lead matching the filters within org scope', async () => {
      mockPrisma.lead.updateMany.mockResolvedValue({ count: 5 });
      const result = await service.archiveAllMatching(
        { stage: LeadStage.NOT_INTERESTED, search: 'john' },
        directorUser,
      );
      expect(mockPrisma.lead.updateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          isDeleted: false,
          orgId: 'org-1',
          stage: LeadStage.NOT_INTERESTED,
        }),
        data: { isDeleted: true },
      });
      const where = (mockPrisma.lead.updateMany.mock.calls[0][0] as { where: Record<string, unknown> }).where;
      expect(where.AND).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            OR: expect.arrayContaining([{ name: { contains: 'john', mode: 'insensitive' } }]),
          }),
        ]),
      );
      expect(result).toEqual({ archived: 5 });
    });
  });

  describe('addNote', () => {
    it('creates an activity with type NOTE by default', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(mockLead);
      mockPrisma.activity.create.mockResolvedValue({});
      await service.addNote('lead-1', 'Test note', repUser);
      expect(mockPrisma.activity.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ type: 'NOTE', note: 'Test note' }) }),
      );
      expect(mockPrisma.$executeRaw).toHaveBeenCalled();
    });

    it('records the given type when one is passed (e.g. CALL_LOG from the composer)', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(mockLead);
      mockPrisma.activity.create.mockResolvedValue({});
      await service.addNote('lead-1', 'Called, no answer', repUser, 'CALL_LOG');
      expect(mockPrisma.activity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'CALL_LOG', note: 'Called, no answer' }),
        }),
      );
    });
  });

  describe('reassign', () => {
    it('logs the new assignee name in the activity note, not their raw user id', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue({
        ...mockLead,
        assignedTo: { id: 'rep-1', name: 'Karan Singh', role: 'SALES_REP' },
      });
      mockPrisma.user.findFirst.mockResolvedValue({ name: 'Priya Sharma' });
      mockPrisma.lead.update.mockResolvedValue({ ...mockLead, assignedToId: 'rep-2' });
      mockPrisma.activity.create.mockResolvedValue({});

      await service.reassign('lead-1', 'rep-2', managerUser);

      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: 'rep-2', orgId: 'org-1' }) }),
      );
      expect(mockPrisma.activity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'REASSIGN',
            note: 'Reassigned from Karan Singh to Priya Sharma',
          }),
        }),
      );
    });

    it('falls back to "unknown user" if the new assignee cannot be found in the org', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue({
        ...mockLead,
        assignedTo: { id: 'rep-1', name: 'Karan Singh', role: 'SALES_REP' },
      });
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.lead.update.mockResolvedValue({ ...mockLead, assignedToId: 'rep-2' });
      mockPrisma.activity.create.mockResolvedValue({});

      await service.reassign('lead-1', 'rep-2', managerUser);

      expect(mockPrisma.activity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ note: 'Reassigned from Karan Singh to unknown user' }),
        }),
      );
    });
  });

  describe('getFacets', () => {
    beforeEach(() => {
      mockPrisma.lead.groupBy.mockResolvedValue([]);
      mockPrisma.lead.findMany.mockResolvedValue([]);
    });

    it('scopes every facet query to assignedToId for SALES_REP', async () => {
      await service.getFacets(repUser);
      expect(mockPrisma.lead.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ assignedToId: 'rep-1' }) }),
      );
      expect(mockPrisma.lead.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ assignedToId: 'rep-1' }) }),
      );
    });

    it('scopes to teamId for MANAGER', async () => {
      await service.getFacets(managerUser);
      expect(mockPrisma.lead.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ teamId: 'team-1' }) }),
      );
    });

    it('maps groupBy results into { value, count } and filters out null course/location', async () => {
      mockPrisma.lead.groupBy
        .mockResolvedValueOnce([{ stage: LeadStage.NEW, _count: { stage: 3 } }])
        .mockResolvedValueOnce([{ source: LeadSource.INSTAGRAM, _count: { source: 2 } }])
        .mockResolvedValueOnce([{ customStageId: 'cs-1', _count: { _all: 4 } }]);
      mockPrisma.lead.findMany
        .mockResolvedValueOnce([{ course: 'Digital Marketing' }, { course: null }])
        .mockResolvedValueOnce([{ location: 'Bangalore' }]);

      const result = await service.getFacets(directorUser);

      expect(result).toEqual({
        stages: [{ value: LeadStage.NEW, count: 3 }],
        sources: [{ value: LeadSource.INSTAGRAM, count: 2 }],
        courses: ['Digital Marketing'],
        cities: ['Bangalore'],
        customStages: [{ id: 'cs-1', count: 4 }],
      });
    });
  });

  describe('getPhoneIndex', () => {
    it('scopes to org, own leads for a SALES_REP, and excludes soft-deleted leads', async () => {
      mockPrisma.lead.findMany.mockResolvedValue([]);
      await service.getPhoneIndex(repUser);
      expect(mockPrisma.lead.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ orgId: repUser.orgId, assignedToId: 'rep-1', isDeleted: false }),
        }),
      );
    });

    it('does not filter by user for a DIRECTOR (org only)', async () => {
      mockPrisma.lead.findMany.mockResolvedValue([]);
      await service.getPhoneIndex(directorUser);
      const { where } = mockPrisma.lead.findMany.mock.calls.at(-1)![0];
      expect(where).toEqual(expect.objectContaining({ orgId: directorUser.orgId, isDeleted: false }));
      expect(where).not.toHaveProperty('assignedToId');
    });

    it('returns one entry per phone and per altPhone, skipping empty numbers', async () => {
      mockPrisma.lead.findMany.mockResolvedValue([
        { id: 'l1', name: 'Asha', phone: '9876543210', altPhone: '9123456789' },
        { id: 'l2', name: 'Ravi', phone: '9000000000', altPhone: null },
        { id: 'l3', name: 'Erased', phone: null, altPhone: null },
      ]);
      const result = await service.getPhoneIndex(repUser);
      expect(result).toEqual([
        { leadId: 'l1', name: 'Asha', phone: '9876543210' },
        { leadId: 'l1', name: 'Asha', phone: '9123456789' },
        { leadId: 'l2', name: 'Ravi', phone: '9000000000' },
      ]);
    });
  });

  describe('getStageStats', () => {
    beforeEach(() => {
      mockPrisma.lead.groupBy.mockResolvedValue([]);
    });

    it('scopes to orgId and role by default', async () => {
      await service.getStageStats(repUser);
      expect(mockPrisma.lead.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ orgId: 'org-1', assignedToId: 'rep-1' }),
        }),
      );
    });

    it('applies other active filters (e.g. city) to the per-stage counts', async () => {
      await service.getStageStats(directorUser, { cities: ['Bangalore'] });
      expect(mockPrisma.lead.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ location: { in: ['Bangalore'] } }) }),
      );
    });

    it('strips stage/stages from the query since these chips are the stage picker', async () => {
      await service.getStageStats(directorUser, { stages: [LeadStage.NEW] });
      const call = mockPrisma.lead.groupBy.mock.calls[0][0] as { where: Record<string, unknown> };
      expect(call.where.stage).toBeUndefined();
    });
  });

  describe('captureWebsiteSignupLead', () => {
    const signup = {
      name: 'Jane Prospect',
      email: 'Jane@Acme.com',
      phone: '9876543210',
      orgName: 'Acme Academy',
      industry: Industry.EDTECH,
      orgSize: OrgSize.SMALL,
    };

    afterEach(() => {
      delete process.env.GENXCRM_INTERNAL_ORG_ID;
    });

    it('no-ops when GENXCRM_INTERNAL_ORG_ID is unset', async () => {
      delete process.env.GENXCRM_INTERNAL_ORG_ID;
      await service.captureWebsiteSignupLead(signup);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('creates a WEBSITE-sourced lead scoped to the internal org and assigns/enrolls it', async () => {
      process.env.GENXCRM_INTERNAL_ORG_ID = 'org-internal';
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      mockPrisma.lead.create.mockResolvedValue({ id: 'lead-signup-1', orgId: 'org-internal' });

      await service.captureWebsiteSignupLead(signup);

      expect(mockPrisma.lead.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Jane Prospect',
            email: 'jane@acme.com',
            phone: '9876543210',
            source: LeadSource.WEBSITE,
            orgId: 'org-internal',
          }),
        }),
      );
      expect(mockNurturing.autoEnroll).toHaveBeenCalledWith('lead-signup-1', 'org-internal', 'lead_created');
      expect(mockAssignments.queueAutomaticAssignment).toHaveBeenCalledWith(
        'lead-signup-1',
        'org-internal',
        null,
        LeadSource.WEBSITE,
      );
    });

    it('touches the existing lead instead of creating a duplicate on repeat email/phone', async () => {
      process.env.GENXCRM_INTERNAL_ORG_ID = 'org-internal';
      mockPrisma.lead.findFirst.mockResolvedValue({ id: 'lead-existing' });

      await service.captureWebsiteSignupLead(signup);

      expect(mockPrisma.lead.create).not.toHaveBeenCalled();
      expect(mockPrisma.lead.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'lead-existing' } }));
      expect(mockNurturing.autoEnroll).not.toHaveBeenCalled();
      expect(mockAssignments.queueAutomaticAssignment).not.toHaveBeenCalled();
    });

    it('swallows errors instead of throwing, so a real signup is never affected', async () => {
      process.env.GENXCRM_INTERNAL_ORG_ID = 'org-internal';
      mockPrisma.lead.findFirst.mockRejectedValue(new Error('db down'));

      await expect(service.captureWebsiteSignupLead(signup)).resolves.toBeUndefined();
    });
  });
});
