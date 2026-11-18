import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bull';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role, LeadSource } from '@prisma/client';
import { AssignmentsService } from './assignments.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';

const mockPrisma = {
  user: { findMany: jest.fn(), update: jest.fn(), count: jest.fn() },
  lead: { findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn(), findFirst: jest.fn() },
  team: { findFirst: jest.fn() },
  activity: { create: jest.fn() },
  organization: { findUnique: jest.fn() },
};

const manager: AuthUser = { id: 'mgr-1', name: 'Mgr', email: 'mgr@t.com', role: Role.MANAGER, teamId: 'team-1', orgId: 'org-1' };
const director: AuthUser = { id: 'dir-1', name: 'Dir', email: 'dir@t.com', role: Role.DIRECTOR, teamId: null, orgId: 'org-1' };

const unassignedLead = { id: 'lead-1', assignedToId: null, isDeleted: false };

const mockRedis = { rpush: jest.fn(), lrange: jest.fn(), del: jest.fn() };
const mockQueue = { add: jest.fn(), client: mockRedis };

const makeReps = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: `rep-${i + 1}`,
    name: `Rep ${i + 1}`,
    role: Role.SALES_REP,
    isActive: true,
    teamId: 'team-1',
    lastAssignedAt: null,
  }));

describe('AssignmentsService', () => {
  let service: AssignmentsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        AssignmentsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: getQueueToken('assignment'), useValue: mockQueue },
      ],
    }).compile();
    service = module.get(AssignmentsService);
  });

  describe('queueForAssignment', () => {
    it('adds job to the assignment queue with retry config', async () => {
      await service.queueForAssignment('lead-1', 'team-1');
      expect(mockQueue.add).toHaveBeenCalledWith(
        'assign',
        { leadId: 'lead-1', teamId: 'team-1' },
        expect.objectContaining({ attempts: 3 }),
      );
    });
  });

  describe('queueForAssignmentOrg', () => {
    it('adds an org-scoped job to the assignment queue with retry config', async () => {
      await service.queueForAssignmentOrg('lead-1', 'org-1');
      expect(mockQueue.add).toHaveBeenCalledWith(
        'assign',
        { leadId: 'lead-1', orgId: 'org-1' },
        expect.objectContaining({ attempts: 3 }),
      );
    });
  });

  describe('bulkAssign', () => {
    beforeEach(() => {
      mockPrisma.team.findFirst.mockResolvedValue({ id: 'team-1' });
    });

    it('queues each in-scope lead and returns count', async () => {
      mockPrisma.lead.findMany.mockResolvedValue([{ id: 'lead-1' }, { id: 'lead-2' }, { id: 'lead-3' }]);
      const result = await service.bulkAssign(['lead-1', 'lead-2', 'lead-3'], 'team-1', director);
      expect(mockQueue.add).toHaveBeenCalledTimes(3);
      expect(result).toEqual({ queued: 3 });
    });

    it('only queues leads that are within the caller scope', async () => {
      // A MANAGER's scope filter should exclude leads outside their team even if
      // requested — the service silently drops them rather than queueing.
      mockPrisma.lead.findMany.mockResolvedValue([{ id: 'lead-1' }]);
      await service.bulkAssign(['lead-1', 'lead-2'], 'team-1', manager);
      expect(mockPrisma.lead.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: { in: ['lead-1', 'lead-2'] }, teamId: 'team-1', orgId: 'org-1' }),
        }),
      );
      expect(mockQueue.add).toHaveBeenCalledTimes(1);
    });

    it('throws NotFoundException when the team is not in the caller org', async () => {
      mockPrisma.team.findFirst.mockResolvedValue(null);
      await expect(service.bulkAssign(['lead-1'], 'other-org-team', director)).rejects.toThrow(NotFoundException);
      expect(mockPrisma.lead.findMany).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when a MANAGER targets a different team', async () => {
      mockPrisma.team.findFirst.mockResolvedValue({ id: 'team-2' });
      await expect(service.bulkAssign(['lead-1'], 'team-2', manager)).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.lead.findMany).not.toHaveBeenCalled();
    });

    it('returns queued:0 without querying when no leadIds are given', async () => {
      const result = await service.bulkAssign([], 'team-1', director);
      expect(result).toEqual({ queued: 0 });
      expect(mockPrisma.team.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('assignOne', () => {
    beforeEach(() => {
      mockPrisma.team.findFirst.mockResolvedValue({ id: 'team-1' });
    });

    it('queues the lead when it is in scope', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue({ id: 'lead-1' });
      const result = await service.assignOne('lead-1', 'team-1', director);
      expect(mockQueue.add).toHaveBeenCalledWith(
        'assign',
        { leadId: 'lead-1', teamId: 'team-1' },
        expect.objectContaining({ attempts: 3 }),
      );
      expect(result).toEqual({ queued: 1 });
    });

    it('throws NotFoundException when the lead is outside the caller scope', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      await expect(service.assignOne('lead-1', 'team-1', manager)).rejects.toThrow(NotFoundException);
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when a MANAGER targets a different team', async () => {
      mockPrisma.team.findFirst.mockResolvedValue({ id: 'team-2' });
      await expect(service.assignOne('lead-1', 'team-2', manager)).rejects.toThrow(ForbiddenException);
      expect(mockQueue.add).not.toHaveBeenCalled();
    });
  });

  describe('assignRoundRobin', () => {
    it('logs a warning and returns early when no active reps exist', async () => {
      mockPrisma.lead.findUnique.mockResolvedValue(unassignedLead);
      mockPrisma.user.findMany.mockResolvedValue([]);
      await service.assignRoundRobin('lead-1', 'team-1');
      expect(mockPrisma.lead.update).not.toHaveBeenCalled();
    });

    it('does not reassign a lead that is already assigned (idempotent)', async () => {
      mockPrisma.lead.findUnique.mockResolvedValue({ id: 'lead-1', assignedToId: 'rep-9', isDeleted: false });
      await service.assignRoundRobin('lead-1', 'team-1');
      expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.lead.update).not.toHaveBeenCalled();
    });

    it('skips when the lead is missing or deleted', async () => {
      mockPrisma.lead.findUnique.mockResolvedValue(null);
      await service.assignRoundRobin('lead-1', 'team-1');
      expect(mockPrisma.lead.update).not.toHaveBeenCalled();
    });

    it("assigns to reps[0] — the rep whose turn is next, regardless of anyone's current load", async () => {
      mockPrisma.lead.findUnique.mockResolvedValue(unassignedLead);
      // Service trusts the query's ordering; it never re-sorts or counts leads itself.
      mockPrisma.user.findMany.mockResolvedValue(makeReps(3));
      mockPrisma.lead.update.mockResolvedValue({});
      mockPrisma.activity.create.mockResolvedValue({});
      await service.assignRoundRobin('lead-1', 'team-1');
      expect(mockPrisma.lead.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ assignedToId: 'rep-1' }) }),
      );
    });

    it('orders reps by oldest lastAssignedAt first (nulls first) so a never-assigned rep gets the next turn immediately', async () => {
      mockPrisma.lead.findUnique.mockResolvedValue(unassignedLead);
      mockPrisma.user.findMany.mockResolvedValue(makeReps(1));
      mockPrisma.lead.update.mockResolvedValue({});
      mockPrisma.activity.create.mockResolvedValue({});
      await service.assignRoundRobin('lead-1', 'team-1');
      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ lastAssignedAt: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }],
        }),
      );
    });

    it('creates an ASSIGNED activity after assignment', async () => {
      mockPrisma.lead.findUnique.mockResolvedValue(unassignedLead);
      mockPrisma.user.findMany.mockResolvedValue(makeReps(1));
      mockPrisma.lead.update.mockResolvedValue({});
      mockPrisma.activity.create.mockResolvedValue({});
      await service.assignRoundRobin('lead-1', 'team-1');
      expect(mockPrisma.activity.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ type: 'ASSIGNED' }) }),
      );
    });

    it('updates the chosen rep lastAssignedAt so the rotation moves on to the next rep', async () => {
      mockPrisma.lead.findUnique.mockResolvedValue(unassignedLead);
      mockPrisma.user.findMany.mockResolvedValue(makeReps(2));
      mockPrisma.lead.update.mockResolvedValue({});
      mockPrisma.activity.create.mockResolvedValue({});
      await service.assignRoundRobin('lead-1', 'team-1');
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'rep-1' }, data: { lastAssignedAt: expect.any(Date) } }),
      );
    });
  });

  describe('assignment-notice debounce', () => {
    const setUpAssignmentToRep1 = () => {
      mockPrisma.lead.findUnique.mockResolvedValue(unassignedLead);
      mockPrisma.user.findMany.mockResolvedValue(makeReps(3));
      mockPrisma.lead.update.mockResolvedValue({});
      mockPrisma.activity.create.mockResolvedValue({});
    };

    it('records the lead and schedules a single debounced notify job keyed by rep', async () => {
      setUpAssignmentToRep1();
      await service.assignRoundRobin('lead-1', 'team-1');
      expect(mockRedis.rpush).toHaveBeenCalledWith('assign-notify:rep-1', 'lead-1');
      expect(mockQueue.add).toHaveBeenCalledWith(
        'notify',
        { repId: 'rep-1' },
        expect.objectContaining({ jobId: 'notify-rep-1', delay: expect.any(Number), attempts: 3 }),
      );
    });

    it('does not record or notify when the lead is not assignable (already assigned)', async () => {
      mockPrisma.lead.findUnique.mockResolvedValue({ id: 'lead-1', assignedToId: 'rep-9', isDeleted: false });
      await service.assignRoundRobin('lead-1', 'team-1');
      expect(mockRedis.rpush).not.toHaveBeenCalled();
      expect(mockQueue.add).not.toHaveBeenCalledWith('notify', expect.anything(), expect.anything());
    });

    it('does not throw and keeps the assignment when scheduling the notice fails', async () => {
      setUpAssignmentToRep1();
      mockRedis.rpush.mockRejectedValueOnce(new Error('redis down'));
      await expect(service.assignRoundRobin('lead-1', 'team-1')).resolves.toBeUndefined();
      expect(mockPrisma.lead.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ assignedToId: 'rep-1' }) }),
      );
    });
  });

  describe('assignRoundRobinOrg', () => {
    it('round-robins across all active org reps, picking whoever is next in rotation', async () => {
      mockPrisma.lead.findUnique.mockResolvedValue(unassignedLead);
      mockPrisma.user.findMany.mockResolvedValue(makeReps(3));
      mockPrisma.lead.update.mockResolvedValue({});
      mockPrisma.activity.create.mockResolvedValue({});
      await service.assignRoundRobinOrg('lead-1', 'org-1');
      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1', role: Role.SALES_REP }) }),
      );
      expect(mockPrisma.lead.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ assignedToId: 'rep-1' }) }),
      );
    });

    it('warns and returns when the org has no active reps', async () => {
      mockPrisma.lead.findUnique.mockResolvedValue(unassignedLead);
      mockPrisma.user.findMany.mockResolvedValue([]);
      await service.assignRoundRobinOrg('lead-1', 'org-1');
      expect(mockPrisma.lead.update).not.toHaveBeenCalled();
    });

    it('does not reassign an already-assigned lead (idempotent)', async () => {
      mockPrisma.lead.findUnique.mockResolvedValue({ id: 'lead-1', assignedToId: 'rep-9', isDeleted: false });
      await service.assignRoundRobinOrg('lead-1', 'org-1');
      expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.lead.update).not.toHaveBeenCalled();
    });

    it("inherits the chosen rep's team so the rep's manager can see a team-less lead", async () => {
      // Lead arrives with no team (inbound webhook/import) — assignment should set its team.
      mockPrisma.lead.findUnique.mockResolvedValue({ id: 'lead-1', assignedToId: null, isDeleted: false, teamId: null });
      mockPrisma.user.findMany.mockResolvedValue(makeReps(1)); // rep-1, teamId: 'team-1'
      mockPrisma.lead.update.mockResolvedValue({});
      mockPrisma.activity.create.mockResolvedValue({});

      await service.assignRoundRobinOrg('lead-1', 'org-1');

      expect(mockPrisma.lead.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ assignedToId: 'rep-1', teamId: 'team-1' }) }),
      );
    });

    it('leaves an existing team untouched when the lead already has one', async () => {
      mockPrisma.lead.findUnique.mockResolvedValue({
        id: 'lead-1',
        assignedToId: null,
        isDeleted: false,
        teamId: 'team-existing',
      });
      mockPrisma.user.findMany.mockResolvedValue(makeReps(1)); // rep-1, teamId: 'team-1'
      mockPrisma.lead.update.mockResolvedValue({});
      mockPrisma.activity.create.mockResolvedValue({});

      await service.assignRoundRobinOrg('lead-1', 'org-1');

      const updateArg = mockPrisma.lead.update.mock.calls.at(-1)![0];
      expect(updateArg.data.assignedToId).toBe('rep-1');
      expect(updateArg.data).not.toHaveProperty('teamId');
    });
  });

  describe('distributeRoundRobin', () => {
    const manager = { id: 'mgr-1', role: Role.MANAGER, teamId: 'team-1', orgId: 'org-1' } as never;
    const director = { id: 'dir-1', role: Role.DIRECTOR, teamId: null, orgId: 'org-1' } as never;

    it('returns early without querying when no ids are given', async () => {
      const result = await service.distributeRoundRobin([], manager);
      expect(result).toEqual({ queued: 0 });
      expect(mockPrisma.lead.findMany).not.toHaveBeenCalled();
    });

    it('scopes to org, unassigned, team-bearing leads and a MANAGER own team', async () => {
      mockPrisma.lead.findMany.mockResolvedValue([]);
      await service.distributeRoundRobin(['lead-1'], manager);
      expect(mockPrisma.lead.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { in: ['lead-1'] },
            assignedToId: null,
            teamId: 'team-1',
            orgId: 'org-1',
            isDeleted: false,
          }),
        }),
      );
    });

    it('does not constrain team for a DIRECTOR (distributes across the org)', async () => {
      mockPrisma.lead.findMany.mockResolvedValue([]);
      await service.distributeRoundRobin(['lead-1'], director);
      const call = mockPrisma.lead.findMany.mock.calls.at(-1)![0];
      expect(call.where.teamId).toEqual({ not: null });
    });

    it('queues each matched lead within its own team and returns the count', async () => {
      mockPrisma.lead.findMany.mockResolvedValue([
        { id: 'lead-1', teamId: 'team-1' },
        { id: 'lead-2', teamId: 'team-2' },
      ]);
      const result = await service.distributeRoundRobin(['lead-1', 'lead-2', 'lead-3'], director);
      expect(mockQueue.add).toHaveBeenCalledWith('assign', { leadId: 'lead-1', teamId: 'team-1' }, expect.anything());
      expect(mockQueue.add).toHaveBeenCalledWith('assign', { leadId: 'lead-2', teamId: 'team-2' }, expect.anything());
      expect(result).toEqual({ queued: 2 });
    });
  });

  describe('distributeAllUnassigned', () => {
    const manager = { id: 'mgr-1', role: Role.MANAGER, teamId: 'team-1', orgId: 'org-1' } as never;
    const director = { id: 'dir-1', role: Role.DIRECTOR, teamId: null, orgId: 'org-1' } as never;

    beforeEach(() => mockPrisma.user.count.mockResolvedValue(3)); // reps available by default

    it('returns reps:0 and queues nothing when there are no active sales reps', async () => {
      mockPrisma.user.count.mockResolvedValue(0);
      const result = await service.distributeAllUnassigned(director);
      expect(result).toEqual({ queued: 0, reps: 0 });
      expect(mockPrisma.lead.findMany).not.toHaveBeenCalled();
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('scopes to the org, unassigned leads and restricts a MANAGER to their own team', async () => {
      mockPrisma.lead.findMany.mockResolvedValue([]);
      await service.distributeAllUnassigned(manager);
      expect(mockPrisma.lead.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            assignedToId: null,
            isDeleted: false,
            orgId: 'org-1',
            teamId: 'team-1',
          }),
        }),
      );
    });

    it('does not constrain team for a DIRECTOR', async () => {
      mockPrisma.lead.findMany.mockResolvedValue([]);
      await service.distributeAllUnassigned(director);
      const call = mockPrisma.lead.findMany.mock.calls.at(-1)![0];
      expect(call.where.teamId).toBeUndefined();
    });

    it('queues teamed leads by team and team-less leads org-wide, returning the count', async () => {
      mockPrisma.lead.findMany.mockResolvedValue([
        { id: 'lead-1', teamId: 'team-1', orgId: 'org-1' },
        { id: 'lead-2', teamId: null, orgId: 'org-1' },
      ]);
      const result = await service.distributeAllUnassigned(director);
      expect(mockQueue.add).toHaveBeenCalledWith('assign', { leadId: 'lead-1', teamId: 'team-1' }, expect.anything());
      expect(mockQueue.add).toHaveBeenCalledWith('assign', { leadId: 'lead-2', orgId: 'org-1' }, expect.anything());
      expect(result).toEqual({ queued: 2, reps: 3 });
    });
  });

  describe('queueAutomaticAssignment', () => {
    it('does not enqueue when autoAssign is off', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({
        routingSettings: { autoAssign: false },
        timezone: 'UTC',
      });
      await service.queueAutomaticAssignment('lead-1', 'org-1', 'team-1', LeadSource.OTHER);
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('enqueues against the lead\'s own team when autoAssign is on and no source routing applies', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({
        routingSettings: { autoAssign: true, skipWeekends: false, workingHoursStart: '00:00', workingHoursEnd: '23:59' },
        timezone: 'UTC',
      });
      await service.queueAutomaticAssignment('lead-1', 'org-1', 'team-1', LeadSource.OTHER);
      expect(mockQueue.add).toHaveBeenCalledWith(
        'assign',
        { leadId: 'lead-1', teamId: 'team-1' },
        expect.objectContaining({ delay: 0 }),
      );
    });

    it('enqueues org-wide when the lead has no team', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({
        routingSettings: { autoAssign: true, workingHoursStart: '00:00', workingHoursEnd: '23:59' },
        timezone: 'UTC',
      });
      await service.queueAutomaticAssignment('lead-1', 'org-1', null, LeadSource.OTHER);
      expect(mockQueue.add).toHaveBeenCalledWith(
        'assign',
        { leadId: 'lead-1', orgId: 'org-1' },
        expect.anything(),
      );
    });

    it('overrides the target team via sourceRouting when a team is configured for the lead\'s source', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({
        routingSettings: {
          autoAssign: true,
          workingHoursStart: '00:00',
          workingHoursEnd: '23:59',
          sourceRouting: { facebookInstagram: 'team-2' },
        },
        timezone: 'UTC',
      });
      mockPrisma.team.findFirst.mockResolvedValue({ id: 'team-2' });

      await service.queueAutomaticAssignment('lead-1', 'org-1', 'team-1', LeadSource.FACEBOOK);

      expect(mockPrisma.team.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'team-2', orgId: 'org-1' } }),
      );
      expect(mockQueue.add).toHaveBeenCalledWith(
        'assign',
        { leadId: 'lead-1', teamId: 'team-2' },
        expect.anything(),
      );
    });

    it('ignores a sourceRouting team that does not belong to this org', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({
        routingSettings: {
          autoAssign: true,
          workingHoursStart: '00:00',
          workingHoursEnd: '23:59',
          sourceRouting: { facebookInstagram: 'team-other-org' },
        },
        timezone: 'UTC',
      });
      mockPrisma.team.findFirst.mockResolvedValue(null); // not found within this org

      await service.queueAutomaticAssignment('lead-1', 'org-1', 'team-1', LeadSource.FACEBOOK);

      expect(mockQueue.add).toHaveBeenCalledWith(
        'assign',
        { leadId: 'lead-1', teamId: 'team-1' }, // falls back to the lead's own team
        expect.anything(),
      );
    });

    it('scopes the routing-settings lookup to the given orgId', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({
        routingSettings: { autoAssign: true, workingHoursStart: '00:00', workingHoursEnd: '23:59' },
        timezone: 'UTC',
      });
      await service.queueAutomaticAssignment('lead-1', 'org-1', 'team-1', LeadSource.OTHER);
      expect(mockPrisma.organization.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'org-1' } }),
      );
    });

    it('passes a non-zero delay when now falls outside the configured working hours', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({
        routingSettings: { autoAssign: true, workingHoursStart: '09:00', workingHoursEnd: '18:00' },
        timezone: 'UTC',
      });
      jest.useFakeTimers().setSystemTime(new Date('2026-09-07T20:00:00.000Z')); // Monday 20:00 UTC — after hours

      await service.queueAutomaticAssignment('lead-1', 'org-1', 'team-1', LeadSource.OTHER);

      const call = mockQueue.add.mock.calls.at(-1)![2];
      expect(call.delay).toBeGreaterThan(0);

      jest.useRealTimers();
    });
  });
});
