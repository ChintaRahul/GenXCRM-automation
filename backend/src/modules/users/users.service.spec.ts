import { Test } from '@nestjs/testing';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role, TeamType, LeadStage } from '@prisma/client';
import { UsersService } from './users.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TrialService } from '../trial/trial.service';
import { MailService } from '../mail/mail.service';
import { BillingService } from '../billing/billing.service';
import { SessionTokenService } from '../../auth/session-token.service';
import { MfaService } from '../../auth/mfa.service';
import type { AuthUser } from '../../common/types/auth-user.type';
import * as bcrypt from 'bcrypt';

jest.mock('bcrypt');
const bcryptHash = bcrypt.hash as jest.Mock;
const bcryptCompare = bcrypt.compare as jest.Mock;

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    count: jest.fn(),
  },
  team: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  verificationToken: {
    create: jest.fn(),
    deleteMany: jest.fn(),
  },
  lead: {
    findMany: jest.fn(),
    updateMany: jest.fn(),
    groupBy: jest.fn(),
  },
  activity: {
    createMany: jest.fn(),
  },
  $transaction: jest.fn(),
};

const mockBilling = {
  updateSeats: jest.fn(),
  hasEmailQuota: jest.fn().mockResolvedValue(true),
  recordEmailSent: jest.fn(),
};

const director: AuthUser = {
  id: 'dir-1',
  name: 'Director',
  email: 'dir@test.com',
  role: Role.DIRECTOR,
  teamId: null,
  orgId: 'org-1',
};
const manager: AuthUser = {
  id: 'mgr-1',
  name: 'Manager',
  email: 'mgr@test.com',
  role: Role.MANAGER,
  teamId: 'team-1',
  orgId: 'org-1',
};
const salesRepCaller: AuthUser = {
  id: 'rep-1',
  name: 'Rep',
  email: 'rep@test.com',
  role: Role.SALES_REP,
  teamId: 'team-1',
  orgId: 'org-1',
};

const mockMail = { send: jest.fn() };
const mockSessionToken = { mint: jest.fn().mockResolvedValue('signed-token') };
const mockMfa = { adminReset: jest.fn() };

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockMail.send.mockResolvedValue(undefined);
    mockBilling.updateSeats.mockResolvedValue(undefined);
    mockBilling.hasEmailQuota.mockResolvedValue(true);
    mockPrisma.$transaction.mockImplementation((ops: unknown) =>
      Array.isArray(ops) ? Promise.all(ops) : Promise.resolve(ops),
    );
    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: TrialService, useValue: { checkLimit: jest.fn() } },
        { provide: MailService, useValue: mockMail },
        { provide: BillingService, useValue: mockBilling },
        { provide: SessionTokenService, useValue: mockSessionToken },
        { provide: MfaService, useValue: mockMfa },
      ],
    }).compile();
    service = module.get(UsersService);
  });

  describe('createTeam — Manager guards', () => {
    const mockTeamResult = { id: 't1', name: 'My Team', type: TeamType.MEMBER, orgId: 'org-1', managerId: 'mgr-1', manager: null, members: [] };

    it('allows Manager to create a MEMBER team and auto-assigns them as manager', async () => {
      mockPrisma.team.create.mockResolvedValue({ ...mockTeamResult, managerId: manager.id });
      await service.createTeam('My Team', undefined, TeamType.MEMBER, manager);
      const call = mockPrisma.team.create.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(call.data.managerId).toBe(manager.id);
    });

    it('throws ForbiddenException when Manager tries to create a MANAGER-type team', async () => {
      await expect(service.createTeam('Mgr Team', undefined, TeamType.MANAGER, manager)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('create — Manager hierarchy guards', () => {
    it('throws ForbiddenException when Manager tries to create a MANAGER user', async () => {
      await expect(
        service.create({ name: 'U', email: 'u@test.com', password: 'pass', role: Role.MANAGER }, manager),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when Manager tries to create a DIRECTOR user', async () => {
      await expect(
        service.create({ name: 'U', email: 'u@test.com', password: 'pass', role: Role.DIRECTOR }, manager),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when Manager assigns user to a different team', async () => {
      await expect(
        service.create(
          { name: 'U', email: 'u@test.com', password: 'pass', role: Role.SALES_REP, teamId: 'team-other' },
          manager,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows Manager to create a SALES_REP for their own team', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.team.findFirst.mockResolvedValue({ id: 'team-1', orgId: 'org-1', type: TeamType.MEMBER });
      bcryptHash.mockResolvedValue('$hashed');
      mockPrisma.user.create.mockResolvedValue({
        id: 'u2', name: 'Rep', email: 'rep@test.com', role: Role.SALES_REP, teamId: 'team-1', createdAt: new Date(),
      });
      await expect(
        service.create(
          { name: 'Rep', email: 'rep@test.com', password: 'Password@1', role: Role.SALES_REP, teamId: 'team-1' },
          manager,
        ),
      ).resolves.toBeDefined();
    });
  });

  describe('create — team type guard', () => {
    it('throws ForbiddenException when adding a SALES_REP to a MANAGER-type team', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.team.findFirst.mockResolvedValue({ id: 't-mgr', orgId: 'org-1', type: TeamType.MANAGER });
      await expect(
        service.create(
          { name: 'Rep', email: 'rep2@test.com', password: 'Password@1', role: Role.SALES_REP, teamId: 't-mgr' },
          director,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows a DIRECTOR to be added to any team type', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.team.findFirst.mockResolvedValue({ id: 't-mem', orgId: 'org-1', type: TeamType.MEMBER });
      bcryptHash.mockResolvedValue('$hashed');
      mockPrisma.user.create.mockResolvedValue({
        id: 'u-dir', name: 'Dir', email: 'dir2@test.com', role: Role.DIRECTOR, teamId: 't-mem', createdAt: new Date(),
      });
      await expect(
        service.create(
          { name: 'Dir', email: 'dir2@test.com', password: 'Password@1', role: Role.DIRECTOR, teamId: 't-mem' },
          director,
        ),
      ).resolves.toBeDefined();
    });
  });

  describe('create', () => {
    it('sets orgId from caller on the new user record', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      bcryptHash.mockResolvedValue('$hashed');
      mockPrisma.user.create.mockResolvedValue({
        id: 'u1',
        name: 'User',
        email: 'new@test.com',
        role: Role.SALES_REP,
        teamId: null,
        createdAt: new Date(),
      });
      await service.create(
        { name: 'User', email: 'new@test.com', password: 'Password@123', role: Role.SALES_REP },
        director,
      );
      const createCall = mockPrisma.user.create.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(createCall.data.orgId).toBe('org-1');
    });

    it('sets mfgRole from the dto when a Director creates the user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      bcryptHash.mockResolvedValue('$hashed');
      mockPrisma.user.create.mockResolvedValue({ id: 'u1', name: 'User', email: 'new@test.com', role: Role.SALES_REP, mfgRole: 'SALES_EXECUTIVE' });
      await service.create(
        { name: 'User', email: 'new@test.com', password: 'Password@123', role: Role.SALES_REP, mfgRole: 'SALES_EXECUTIVE' } as never,
        director,
      );
      const createCall = mockPrisma.user.create.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(createCall.data.mfgRole).toBe('SALES_EXECUTIVE');
    });

    it('a Manager cannot set mfgRole on a new user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.create(
          { name: 'User', email: 'new@test.com', password: 'pass', role: Role.SALES_REP, mfgRole: 'SALES_EXECUTIVE' } as never,
          manager,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });

    it('throws ConflictException when an active user already has the email', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'existing', isActive: true, orgId: 'org-1' });
      await expect(
        service.create({ name: 'User', email: 'dup@test.com', password: 'pass', role: Role.SALES_REP }, director),
      ).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException when a deactivated user in another org owns the email', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'existing', isActive: false, orgId: 'org-other' });
      await expect(
        service.create({ name: 'User', email: 'dup@test.com', password: 'pass', role: Role.SALES_REP }, director),
      ).rejects.toThrow(ConflictException);
    });

    it('reactivates a deactivated member in the same org instead of creating a new row', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'old-1', isActive: false, orgId: 'org-1' });
      mockPrisma.user.update.mockResolvedValue({
        id: 'old-1', name: 'User', email: 'new@test.com', role: Role.SALES_REP, teamId: null, createdAt: new Date(),
      });
      await service.create({ name: 'User', email: 'new@test.com', role: Role.SALES_REP }, director);
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'old-1' },
          data: expect.objectContaining({ isActive: true, passwordHash: null, mustChangePassword: false }),
        }),
      );
    });

    it('re-issues a set-password invite when reactivating a removed member', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'old-1', isActive: false, orgId: 'org-1' });
      mockPrisma.user.update.mockResolvedValue({
        id: 'old-1', name: 'User', email: 'new@test.com', role: Role.SALES_REP, teamId: null, createdAt: new Date(),
      });
      await service.create({ name: 'User', email: 'new@test.com', role: Role.SALES_REP }, director);
      await new Promise((resolve) => setImmediate(resolve));
      expect(mockMail.send).toHaveBeenCalledWith(
        'new@test.com',
        expect.any(String),
        expect.stringContaining('/reset-password?token='),
      );
    });

    it('normalizes the email before lookup and persistence', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'u1', name: 'User', email: 'mixed@test.com', role: Role.SALES_REP, teamId: null, createdAt: new Date(),
      });
      await service.create({ name: 'User', email: '  Mixed@Test.com ', role: Role.SALES_REP }, director);
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'mixed@test.com' } });
      const createCall = mockPrisma.user.create.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(createCall.data.email).toBe('mixed@test.com');
    });

    it('hashes password and does not persist plaintext', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      bcryptHash.mockResolvedValue('$hashed');
      mockPrisma.user.create.mockResolvedValue({
        id: 'u1',
        name: 'User',
        email: 'new@test.com',
        role: Role.SALES_REP,
        teamId: null,
        createdAt: new Date(),
      });
      await service.create(
        { name: 'User', email: 'new@test.com', password: 'Password@123', role: Role.SALES_REP },
        director,
      );
      const createCall = mockPrisma.user.create.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(createCall.data.passwordHash).toBe('$hashed');
      expect(createCall.data).not.toHaveProperty('password');
    });

    // ── Invite flow: member sets their own password via an emailed link ──
    const createdUser = {
      id: 'u1', name: 'User', email: 'new@test.com', role: Role.SALES_REP, teamId: null, createdAt: new Date(),
    };

    it('creates the member with no password when dto.password is omitted', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue(createdUser);
      await service.create({ name: 'User', email: 'new@test.com', role: Role.SALES_REP }, director);
      // No password is hashed — the member sets their own via the invite link.
      expect(bcryptHash).not.toHaveBeenCalled();
      const createCall = mockPrisma.user.create.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(createCall.data.passwordHash).toBeNull();
    });

    it('creates the member pre-verified (skips the verify-on-login gate)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue(createdUser);
      await service.create({ name: 'User', email: 'new@test.com', role: Role.SALES_REP }, director);
      const createCall = mockPrisma.user.create.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(createCall.data.emailVerified).toBe(true);
      expect(createCall.data.emailVerifiedAt).toBeInstanceOf(Date);
    });

    it('issues a single-use set-password token and emails the link', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue(createdUser);
      await service.create({ name: 'User', email: 'new@test.com', role: Role.SALES_REP }, director);
      // The invite is fire-and-forget (token write → email); flush microtasks first.
      await new Promise((resolve) => setImmediate(resolve));
      expect(mockPrisma.verificationToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'u1', type: 'PASSWORD_RESET' }),
        }),
      );
      expect(mockMail.send).toHaveBeenCalledWith(
        'new@test.com',
        expect.any(String),
        expect.stringContaining('/reset-password?token='),
      );
    });

    it('skips the invite email when the org has exhausted its email quota', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue(createdUser);
      mockBilling.hasEmailQuota.mockResolvedValue(false);
      await service.create({ name: 'User', email: 'new@test.com', role: Role.SALES_REP }, director);
      await new Promise((resolve) => setImmediate(resolve));
      expect(mockMail.send).not.toHaveBeenCalled();
    });

    it('honors an explicit dto.password and does not send an invite link', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      bcryptHash.mockResolvedValue('$hashed');
      mockPrisma.user.create.mockResolvedValue(createdUser);
      await service.create(
        { name: 'User', email: 'new@test.com', password: 'Password@123', role: Role.SALES_REP },
        director,
      );
      const createCall = mockPrisma.user.create.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(createCall.data.passwordHash).toBe('$hashed');
      expect(mockMail.send).not.toHaveBeenCalled();
      expect(mockPrisma.verificationToken.create).not.toHaveBeenCalled();
    });

    it('still returns the created user when the invite email fails', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue(createdUser);
      mockMail.send.mockRejectedValue(new Error('SES down'));
      await expect(
        service.create({ name: 'User', email: 'new@test.com', role: Role.SALES_REP }, director),
      ).resolves.toMatchObject({ id: 'u1', email: 'new@test.com' });
    });
  });

  describe('directory', () => {
    it("lists every active user of the caller's organisation (id, name, roles only) whatever the caller's own visibility", async () => {
      mockPrisma.user.findMany.mockResolvedValue([{ id: 'u9', name: 'Asha', role: 'SALES_REP', mfgRole: 'SERVICE_ENGINEER' }]);
      const rows = await service.directory(salesRepCaller);
      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orgId: salesRepCaller.orgId, isActive: true },
          select: { id: true, name: true, role: true, mfgRole: true },
        }),
      );
      expect(rows).toHaveLength(1);
    });

    it('returns nothing for a caller with no organisation', async () => {
      expect(await service.directory({ ...salesRepCaller, orgId: null } as typeof salesRepCaller)).toEqual([]);
      expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    beforeEach(() => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      mockPrisma.team.findMany.mockResolvedValue([]);
    });

    it('includes managed team members AND unassigned users for MANAGER', async () => {
      mockPrisma.team.findMany.mockResolvedValue([{ id: 'team-new' }]);
      await service.findAll(manager);
      const call = mockPrisma.user.findMany.mock.calls[0][0] as { where: Record<string, unknown> & { OR?: unknown[] } };
      // OR clause must include both teamId filter and teamId: null
      expect(call.where.OR).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ teamId: { in: expect.arrayContaining(['team-1', 'team-new']) } }),
          { teamId: null },
        ]),
      );
    });

    it('only shows unassigned users when Manager has no managed teams', async () => {
      mockPrisma.team.findMany.mockResolvedValue([]);
      const noTeamManager: AuthUser = { ...manager, teamId: null };
      await service.findAll(noTeamManager);
      const call = mockPrisma.user.findMany.mock.calls[0][0] as { where: Record<string, unknown> & { OR?: unknown[] } };
      expect(call.where.OR).toEqual(expect.arrayContaining([{ teamId: null }]));
    });

    it('queries managerId on team to find managed teams', async () => {
      mockPrisma.team.findMany.mockResolvedValue([]);
      await service.findAll(manager);
      expect(mockPrisma.team.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ managerId: manager.id }) }),
      );
    });

    it('returns all active users for DIRECTOR without team filter', async () => {
      await service.findAll(director);
      const call = mockPrisma.user.findMany.mock.calls[0][0] as { where: Record<string, unknown> };
      expect(call.where).not.toHaveProperty('teamId');
      expect(call.where).toMatchObject({ isActive: true });
    });

    it('does not query lead counts when includeOpenLeads is not requested', async () => {
      await service.findAll(director);
      expect(mockPrisma.lead.groupBy).not.toHaveBeenCalled();
    });

    it('attaches openLeads counts per user when includeOpenLeads is true', async () => {
      mockPrisma.user.findMany.mockResolvedValue([
        { id: 'u1', name: 'Rep One' },
        { id: 'u2', name: 'Rep Two' },
      ]);
      mockPrisma.lead.groupBy.mockResolvedValue([
        { assignedToId: 'u1', _count: { assignedToId: 3 } },
      ]);
      const result = await service.findAll(director, true);
      expect(mockPrisma.lead.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          by: ['assignedToId'],
          where: expect.objectContaining({
            isDeleted: false,
            orgId: 'org-1',
            assignedToId: { in: ['u1', 'u2'] },
            stage: {
              notIn: [
                LeadStage.ENROLLED,
                LeadStage.NOT_INTERESTED,
                LeadStage.DROPPED,
                LeadStage.CLOSED_WON,
                LeadStage.CLOSED_LOST,
              ],
            },
          }),
        }),
      );
      expect(result).toEqual([
        { id: 'u1', name: 'Rep One', pending: true, mfaConfigured: false, openLeads: 3 },
        { id: 'u2', name: 'Rep Two', pending: true, mfaConfigured: false, openLeads: 0 },
      ]);
    });

    it('scopes query to orgId for DIRECTOR', async () => {
      await service.findAll(director);
      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1' }) }),
      );
    });

    it('scopes query to orgId for MANAGER', async () => {
      mockPrisma.team.findMany.mockResolvedValue([]);
      await service.findAll(manager);
      expect(mockPrisma.team.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1' }) }),
      );
    });

    it('scopes query to self only for SALES_REP', async () => {
      await service.findAll(salesRepCaller);
      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'rep-1', orgId: 'org-1' }),
        }),
      );
      expect(mockPrisma.team.findMany).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when user does not exist', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      await expect(service.findOne('bad-id', director)).rejects.toThrow(NotFoundException);
    });

    it('returns user when found, with a computed pending flag instead of the raw hash', async () => {
      const user = { id: 'u1', name: 'User', email: 'u@test.com', role: Role.SALES_REP, teamId: null, team: null, passwordHash: '$hash' };
      mockPrisma.user.findFirst.mockResolvedValue(user);
      const result = await service.findOne('u1', director);
      expect(result).toMatchObject({ id: 'u1', name: 'User', pending: false });
      expect(result).not.toHaveProperty('passwordHash');
    });

    it('marks a user without a password as pending', async () => {
      const user = { id: 'u1', name: 'User', email: 'u@test.com', role: Role.SALES_REP, teamId: null, team: null, passwordHash: null };
      mockPrisma.user.findFirst.mockResolvedValue(user);
      const result = await service.findOne('u1', director);
      expect(result).toMatchObject({ pending: true });
    });

    it('scopes lookup to self for SALES_REP without clobbering the requested id', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      await expect(service.findOne('other-user', salesRepCaller)).rejects.toThrow(NotFoundException);
      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [{ id: 'other-user' }, { orgId: 'org-1', id: 'rep-1' }],
          },
        }),
      );
    });
  });

  describe('resendInvite', () => {
    const pendingRep = { id: 'u2', name: 'Rep', email: 'r@test.com', role: Role.SALES_REP, orgId: 'org-1', teamId: 'team-1', passwordHash: null };
    const acceptedRep = { ...pendingRep, passwordHash: '$hash' };

    it('throws NotFoundException when user is not in caller org', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      await expect(service.resendInvite('u2', director)).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when the member already set a password', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(acceptedRep);
      await expect(service.resendInvite('u2', director)).rejects.toThrow(ConflictException);
      expect(mockMail.send).not.toHaveBeenCalled();
    });

    it('sends a fresh invite for a pending member', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(pendingRep);
      mockMail.send.mockResolvedValue(true);
      await service.resendInvite('u2', director);
      expect(mockPrisma.verificationToken.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ userId: 'u2' }) }),
      );
      expect(mockMail.send).toHaveBeenCalledWith(
        'r@test.com',
        expect.any(String),
        expect.stringContaining('/reset-password?token='),
      );
    });

    it('throws ForbiddenException when the send fails (e.g. quota exhausted)', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(pendingRep);
      mockBilling.hasEmailQuota.mockResolvedValue(false);
      await expect(service.resendInvite('u2', director)).rejects.toThrow(ForbiddenException);
    });

    it('allows Manager to resend for a member of their managed team', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(pendingRep);
      mockPrisma.team.findMany.mockResolvedValue([{ id: 'team-1' }]);
      mockMail.send.mockResolvedValue(true);
      await expect(service.resendInvite('u2', manager)).resolves.toBeUndefined();
    });

    it('throws ForbiddenException when Manager targets a member outside their managed teams', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ ...pendingRep, teamId: 'team-other' });
      mockPrisma.team.findMany.mockResolvedValue([{ id: 'team-1' }]);
      await expect(service.resendInvite('u2', manager)).rejects.toThrow(ForbiddenException);
      expect(mockMail.send).not.toHaveBeenCalled();
    });
  });

  describe('resetMfa', () => {
    it('lets a Director reset a teammate in the same org', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'rep-1', orgId: 'org-1' });
      await service.resetMfa('rep-1', director);
      expect(mockMfa.adminReset).toHaveBeenCalledWith('rep-1');
    });

    it('throws NotFoundException for a user outside the caller org', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      await expect(service.resetMfa('rep-2', director)).rejects.toThrow(NotFoundException);
      expect(mockMfa.adminReset).not.toHaveBeenCalled();
    });
  });

  describe('deactivate', () => {
    const removedRep = { id: 'u1', teamId: 'team-1', orgId: 'org-1' };

    beforeEach(() => {
      mockPrisma.user.update.mockResolvedValue({});
      mockPrisma.user.count.mockResolvedValue(4);
      mockPrisma.lead.findMany.mockResolvedValue([]);
    });

    it('sets isActive false without deleting the record', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(removedRep);
      mockPrisma.team.findFirst.mockResolvedValue({ managerId: 'mgr-1' });
      mockPrisma.user.findFirst
        .mockResolvedValueOnce(removedRep) // load removed user
        .mockResolvedValueOnce({ id: 'mgr-1' }); // active manager lookup
      await service.deactivate('u1', director);
      expect(mockPrisma.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { isActive: false } });
    });

    it('reassigns the removed rep open leads to their team manager', async () => {
      mockPrisma.user.findFirst
        .mockResolvedValueOnce(removedRep) // load removed user
        .mockResolvedValueOnce({ id: 'mgr-1' }); // active manager
      mockPrisma.team.findFirst.mockResolvedValue({ managerId: 'mgr-1' });
      mockPrisma.lead.findMany.mockResolvedValue([{ id: 'l1' }, { id: 'l2' }]);

      await service.deactivate('u1', director);

      expect(mockPrisma.lead.updateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({ assignedToId: 'u1', isDeleted: false, orgId: 'org-1' }),
        data: { assignedToId: 'mgr-1' },
      });
      expect(mockPrisma.activity.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([expect.objectContaining({ leadId: 'l1', userId: 'mgr-1', type: 'REASSIGN' })]),
      });
    });

    it('falls back to an active Director when the team has no manager', async () => {
      mockPrisma.user.findFirst
        .mockResolvedValueOnce(removedRep) // load removed user
        .mockResolvedValueOnce({ id: 'dir-1' }); // director fallback
      mockPrisma.team.findFirst.mockResolvedValue({ managerId: null });
      mockPrisma.lead.findMany.mockResolvedValue([{ id: 'l1' }]);

      await service.deactivate('u1', director);

      expect(mockPrisma.lead.updateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({ assignedToId: 'u1' }),
        data: { assignedToId: 'dir-1' },
      });
    });

    it('syncs the billed seat count to active members', async () => {
      mockPrisma.user.findFirst
        .mockResolvedValueOnce(removedRep)
        .mockResolvedValueOnce({ id: 'mgr-1' });
      mockPrisma.team.findFirst.mockResolvedValue({ managerId: 'mgr-1' });
      await service.deactivate('u1', director);
      expect(mockPrisma.user.count).toHaveBeenCalledWith({
        where: { orgId: 'org-1', isActive: true },
      });
      expect(mockBilling.updateSeats).toHaveBeenCalledWith(4, director);
    });

    it('does not fail when seat sync throws (trial org with no subscription)', async () => {
      mockPrisma.user.findFirst
        .mockResolvedValueOnce(removedRep)
        .mockResolvedValueOnce({ id: 'mgr-1' });
      mockPrisma.team.findFirst.mockResolvedValue({ managerId: 'mgr-1' });
      mockBilling.updateSeats.mockRejectedValue(new ForbiddenException('no subscription'));
      await expect(service.deactivate('u1', director)).resolves.toBeDefined();
    });
  });

  describe('updateMe', () => {
    const selfUser = { id: 'rep-1', name: 'Rep', email: 'rep@test.com', passwordHash: '$oldHash' };

    it('throws NotFoundException when the caller record is gone', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.updateMe({ name: 'New Name' }, salesRepCaller)).rejects.toThrow(NotFoundException);
    });

    it('updates only name when no password change is requested', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(selfUser);
      mockPrisma.user.update.mockResolvedValue({ ...selfUser, name: 'New Name' });
      await service.updateMe({ name: 'New Name' }, salesRepCaller);
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'rep-1' }, data: { name: 'New Name' } }),
      );
      expect(bcryptCompare).not.toHaveBeenCalled();
    });

    it('never scopes the update by a caller-supplied id — always the caller\'s own record', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(selfUser);
      mockPrisma.user.update.mockResolvedValue(selfUser);
      await service.updateMe({ name: 'X' }, salesRepCaller);
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({ where: { id: salesRepCaller.id } });
    });

    it('throws ForbiddenException when newPassword is set without currentPassword', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(selfUser);
      await expect(
        service.updateMe({ newPassword: 'NewPassword@1' }, salesRepCaller),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when currentPassword is incorrect', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(selfUser);
      bcryptCompare.mockResolvedValue(false);
      await expect(
        service.updateMe({ currentPassword: 'wrong', newPassword: 'NewPassword@1' }, salesRepCaller),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when the account has no password (SSO-only)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...selfUser, passwordHash: null });
      await expect(
        service.updateMe({ currentPassword: 'anything', newPassword: 'NewPassword@1' }, salesRepCaller),
      ).rejects.toThrow(ForbiddenException);
      expect(bcryptCompare).not.toHaveBeenCalled();
    });

    it('hashes and persists the new password when currentPassword is verified', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(selfUser);
      bcryptCompare.mockResolvedValue(true);
      bcryptHash.mockResolvedValue('$newHash');
      mockPrisma.user.update.mockResolvedValue(selfUser);
      await service.updateMe({ currentPassword: 'old-pass', newPassword: 'NewPassword@1' }, salesRepCaller);
      expect(bcryptCompare).toHaveBeenCalledWith('old-pass', '$oldHash');
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ passwordHash: '$newHash' }) }),
      );
    });
  });

  describe('update — Manager hierarchy guards', () => {
    const repInTeam    = { id: 'u2', name: 'Rep', email: 'r@test.com', role: Role.SALES_REP, orgId: 'org-1', isActive: true, teamId: 'team-1' };
    const repInOtherTeam = { ...repInTeam, id: 'u3', teamId: 'team-other' };
    const unassignedRep  = { ...repInTeam, id: 'u4', teamId: null };

    // manager manages 'team-1'
    const managedTeams = [{ id: 'team-1' }];
    const noManagedTeams: { id: string }[] = [];

    it('throws ForbiddenException when Manager tries to change role', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(repInTeam);
      mockPrisma.team.findMany.mockResolvedValue(managedTeams);
      await expect(service.update('u2', { role: Role.MANAGER }, manager)).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when Manager assigns user to a team they do not manage', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(repInTeam);
      mockPrisma.team.findMany.mockResolvedValue(managedTeams); // only manages team-1
      await expect(service.update('u2', { teamId: 'team-other' }, manager)).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when Manager modifies user outside their managed teams', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(repInOtherTeam);
      mockPrisma.team.findMany.mockResolvedValue(managedTeams); // only manages team-1; user is in team-other
      await expect(service.update('u3', { teamId: null }, manager)).rejects.toThrow(ForbiddenException);
    });

    it('allows Manager to remove a user from their managed team', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(repInTeam);
      mockPrisma.team.findMany.mockResolvedValue(managedTeams);
      mockPrisma.user.update.mockResolvedValue({ ...repInTeam, teamId: null });
      await expect(service.update('u2', { teamId: null }, manager)).resolves.toBeDefined();
    });

    it('allows Manager to assign an unassigned user to a team they manage', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(unassignedRep);
      mockPrisma.team.findMany.mockResolvedValue(managedTeams); // manages team-1
      mockPrisma.team.findFirst.mockResolvedValue({ id: 'team-1', orgId: 'org-1', type: TeamType.MEMBER });
      mockPrisma.user.update.mockResolvedValue({ ...unassignedRep, teamId: 'team-1' });
      await expect(service.update('u4', { teamId: 'team-1' }, manager)).resolves.toBeDefined();
    });

    it('throws ForbiddenException when Manager has no managed teams and tries to assign', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(unassignedRep);
      mockPrisma.team.findMany.mockResolvedValue(noManagedTeams);
      await expect(service.update('u4', { teamId: 'team-1' }, manager)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('update', () => {
    const existingUser = { id: 'u1', name: 'Bob', email: 'b@test.com', role: Role.SALES_REP, orgId: 'org-1', isActive: true };

    it('throws NotFoundException when user is not in caller org', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      await expect(service.update('u1', { role: Role.MANAGER }, director)).rejects.toThrow(NotFoundException);
      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: 'u1', orgId: 'org-1' }) }),
      );
    });

    it('updates role and returns updated user', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(existingUser);
      mockPrisma.user.update.mockResolvedValue({ ...existingUser, role: Role.MANAGER });
      const result = await service.update('u1', { role: Role.MANAGER }, director);
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'u1' }, data: expect.objectContaining({ role: Role.MANAGER }) }),
      );
      expect(result).toMatchObject({ role: Role.MANAGER });
    });

    it('prevents demoting the last Director', async () => {
      const lastDirector = { ...existingUser, role: Role.DIRECTOR };
      mockPrisma.user.findFirst.mockResolvedValue(lastDirector);
      mockPrisma.user.count.mockResolvedValue(1);
      await expect(service.update('u1', { role: Role.MANAGER }, director)).rejects.toThrow(ForbiddenException);
    });

    it('allows demoting a Director when there are multiple', async () => {
      const aDirector = { ...existingUser, role: Role.DIRECTOR };
      mockPrisma.user.findFirst.mockResolvedValue(aDirector);
      mockPrisma.user.count.mockResolvedValue(2);
      mockPrisma.user.update.mockResolvedValue({ ...aDirector, role: Role.MANAGER });
      await expect(service.update('u1', { role: Role.MANAGER }, director)).resolves.toBeDefined();
    });

    it('throws NotFoundException when target teamId is not in caller org', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(existingUser);
      mockPrisma.team.findFirst.mockResolvedValue(null);
      await expect(service.update('u1', { teamId: 'team-999' }, director)).rejects.toThrow(NotFoundException);
    });

    // Regression for SCRUM-12: promoting a Sales Rep to Manager sent teamId: "" (not null),
    // which used to reach Prisma verbatim and 500 with an unhandled foreign-key error since
    // no Team has id "".
    it('treats teamId: "" the same as null instead of erroring', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ ...existingUser, teamId: 'team-1' });
      mockPrisma.user.update.mockResolvedValue({ ...existingUser, role: Role.MANAGER, teamId: null });
      const result = await service.update('u1', { role: Role.MANAGER, teamId: '' }, director);
      expect(mockPrisma.team.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'u1' },
          data: expect.objectContaining({ role: Role.MANAGER, teamId: null }),
        }),
      );
      expect(result).toMatchObject({ role: Role.MANAGER, teamId: null });
    });

    it('sets monthlyTarget when provided', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(existingUser);
      mockPrisma.user.update.mockResolvedValue({ ...existingUser, monthlyTarget: 50_000 });
      await service.update('u1', { monthlyTarget: 50_000 }, director);
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ monthlyTarget: 50_000 }) }),
      );
    });

    it('a Director can assign an mfgRole', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(existingUser);
      mockPrisma.user.update.mockResolvedValue({ ...existingUser, mfgRole: 'SALES_EXECUTIVE' });
      await service.update('u1', { mfgRole: 'SALES_EXECUTIVE' } as never, director);
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ mfgRole: 'SALES_EXECUTIVE' }) }),
      );
    });

    it('a Manager cannot assign an mfgRole', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(existingUser);
      await expect(service.update('u1', { mfgRole: 'SALES_EXECUTIVE' } as never, manager)).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('update — team type guard', () => {
    const salesRep = { id: 'u5', name: 'Rep', email: 'r@test.com', role: Role.SALES_REP, orgId: 'org-1', isActive: true, teamId: null };
    const mgr = { id: 'u6', name: 'Mgr', email: 'm@test.com', role: Role.MANAGER, orgId: 'org-1', isActive: true, teamId: null };

    it('throws ForbiddenException when assigning a SALES_REP to a MANAGER-type team', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(salesRep);
      mockPrisma.team.findFirst.mockResolvedValue({ id: 't-mgr', orgId: 'org-1', type: TeamType.MANAGER });
      await expect(service.update('u5', { teamId: 't-mgr' }, director)).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when assigning a MANAGER to a MEMBER-type team', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(mgr);
      mockPrisma.team.findFirst.mockResolvedValue({ id: 't-mem', orgId: 'org-1', type: TeamType.MEMBER });
      await expect(service.update('u6', { teamId: 't-mem' }, director)).rejects.toThrow(ForbiddenException);
    });

    it('allows assigning a SALES_REP to a MEMBER-type team', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(salesRep);
      mockPrisma.team.findFirst.mockResolvedValue({ id: 't-mem', orgId: 'org-1', type: TeamType.MEMBER });
      mockPrisma.user.update.mockResolvedValue({ ...salesRep, teamId: 't-mem' });
      await expect(service.update('u5', { teamId: 't-mem' }, director)).resolves.toBeDefined();
    });

    it('allows assigning a MANAGER to a MANAGER-type team', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(mgr);
      mockPrisma.team.findFirst.mockResolvedValue({ id: 't-mgr', orgId: 'org-1', type: TeamType.MANAGER });
      mockPrisma.user.update.mockResolvedValue({ ...mgr, teamId: 't-mgr' });
      await expect(service.update('u6', { teamId: 't-mgr' }, director)).resolves.toBeDefined();
    });

    it('allows a DIRECTOR to be assigned to any team type (regression)', async () => {
      // A Member team only "accepts" Sales Reps, but a Director oversees the whole
      // org and must be assignable to any team — this previously failed.
      const dirUser = { id: 'u7', name: 'Dir', email: 'd@test.com', role: Role.DIRECTOR, orgId: 'org-1', isActive: true, teamId: null };
      mockPrisma.user.findFirst.mockResolvedValue(dirUser);
      mockPrisma.team.findFirst.mockResolvedValue({ id: 't-mem', orgId: 'org-1', type: TeamType.MEMBER });
      mockPrisma.user.update.mockResolvedValue({ ...dirUser, teamId: 't-mem' });
      await expect(service.update('u7', { teamId: 't-mem' }, director)).resolves.toBeDefined();
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ teamId: 't-mem' }) }),
      );
    });
  });

  describe('updateTeam', () => {
    const existingTeam = { id: 't1', name: 'Alpha', orgId: 'org-1', managerId: null };

    it('throws NotFoundException when team is not in caller org', async () => {
      mockPrisma.team.findFirst.mockResolvedValue(null);
      await expect(service.updateTeam('t1', { name: 'Beta' }, director)).rejects.toThrow(NotFoundException);
      expect(mockPrisma.team.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: 't1', orgId: 'org-1' }) }),
      );
    });

    it('renames the team', async () => {
      mockPrisma.team.findFirst.mockResolvedValue(existingTeam);
      mockPrisma.team.update.mockResolvedValue({ ...existingTeam, name: 'Beta' });
      await service.updateTeam('t1', { name: 'Beta' }, director);
      expect(mockPrisma.team.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 't1' }, data: expect.objectContaining({ name: 'Beta' }) }),
      );
    });

    it('changes manager (sets managerId)', async () => {
      mockPrisma.team.findFirst.mockResolvedValue(existingTeam);
      mockPrisma.team.update.mockResolvedValue({ ...existingTeam, managerId: 'mgr-1' });
      await service.updateTeam('t1', { managerId: 'mgr-1' }, director);
      expect(mockPrisma.team.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ managerId: 'mgr-1' }) }),
      );
    });

    it('removes manager (sets managerId to null)', async () => {
      mockPrisma.team.findFirst.mockResolvedValue({ ...existingTeam, managerId: 'mgr-1' });
      mockPrisma.team.update.mockResolvedValue({ ...existingTeam, managerId: null });
      await service.updateTeam('t1', { managerId: null }, director);
      expect(mockPrisma.team.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ managerId: null }) }),
      );
    });

    it('sets monthlyTarget when a valid non-negative integer is provided', async () => {
      mockPrisma.team.findFirst.mockResolvedValue(existingTeam);
      mockPrisma.team.update.mockResolvedValue({ ...existingTeam, monthlyTarget: 200_000 });
      await service.updateTeam('t1', { monthlyTarget: 200_000 }, director);
      expect(mockPrisma.team.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ monthlyTarget: 200_000 }) }),
      );
    });

    it('ignores a negative or non-integer monthlyTarget instead of passing it to Prisma', async () => {
      mockPrisma.team.findFirst.mockResolvedValue(existingTeam);
      mockPrisma.team.update.mockResolvedValue(existingTeam);
      await service.updateTeam('t1', { monthlyTarget: -5 }, director);
      const data = (mockPrisma.team.update.mock.calls[0][0] as { data: Record<string, unknown> }).data;
      expect(data).not.toHaveProperty('monthlyTarget');
    });
  });

  describe('deleteTeam', () => {
    const existingTeam = { id: 't1', name: 'Alpha', orgId: 'org-1' };

    it('throws NotFoundException when team is not in caller org', async () => {
      mockPrisma.team.findFirst.mockResolvedValue(null);
      await expect(service.deleteTeam('t1', director)).rejects.toThrow(NotFoundException);
    });

    it('detaches members (updateMany) before deleting the team', async () => {
      mockPrisma.team.findFirst.mockResolvedValue(existingTeam);
      mockPrisma.user.updateMany.mockResolvedValue({ count: 2 });
      mockPrisma.team.delete.mockResolvedValue(existingTeam);
      await service.deleteTeam('t1', director);
      expect(mockPrisma.user.updateMany).toHaveBeenCalledWith({ where: { teamId: 't1' }, data: { teamId: null } });
      expect(mockPrisma.team.delete).toHaveBeenCalledWith({ where: { id: 't1' } });
    });

    it('deletes the team after detaching members', async () => {
      mockPrisma.team.findFirst.mockResolvedValue(existingTeam);
      mockPrisma.user.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.team.delete.mockResolvedValue(existingTeam);
      await service.deleteTeam('t1', director);
      const updateManyOrder = mockPrisma.user.updateMany.mock.invocationCallOrder[0];
      const deleteOrder = mockPrisma.team.delete.mock.invocationCallOrder[0];
      expect(updateManyOrder).toBeLessThan(deleteOrder);
    });
  });

  describe('findAllTeams', () => {
    beforeEach(() => mockPrisma.team.findMany.mockResolvedValue([]));

    it('Director sees all org teams (no team filter)', () => {
      void service.findAllTeams(director);
      const call = mockPrisma.team.findMany.mock.calls[0][0] as { where: Record<string, unknown> };
      expect(call.where).not.toHaveProperty('OR');
      expect(call.where).toMatchObject({ orgId: 'org-1' });
    });

    it('Manager sees only teams they manage or belong to', () => {
      void service.findAllTeams(manager);
      const call = mockPrisma.team.findMany.mock.calls[0][0] as { where: Record<string, unknown> & { OR?: unknown[] } };
      expect(call.where.OR).toEqual(
        expect.arrayContaining([
          { managerId: manager.id },
          { id: manager.teamId },
        ]),
      );
    });

    it('Manager with no teamId sees only teams they manage via managerId', () => {
      const noTeamManager: AuthUser = { ...manager, teamId: null };
      void service.findAllTeams(noTeamManager);
      const call = mockPrisma.team.findMany.mock.calls[0][0] as { where: Record<string, unknown> & { OR?: unknown[] } };
      expect(call.where.OR).toEqual([{ managerId: noTeamManager.id }]);
    });

    it('scopes team query to orgId for both roles', () => {
      void service.findAllTeams(director);
      expect(mockPrisma.team.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1' }) }),
      );
    });
  });

  describe('registerPushToken', () => {
    it("updates the caller's own pushToken and pushTokenUpdatedAt", async () => {
      mockPrisma.user.update.mockResolvedValue({});

      const result = await service.registerPushToken('fcm-token-abc', salesRepCaller);

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'rep-1' },
        data: { pushToken: 'fcm-token-abc', pushTokenUpdatedAt: expect.any(Date) },
      });
      expect(result).toEqual({ ok: true });
    });
  });
});
