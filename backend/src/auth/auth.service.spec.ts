import { Test } from '@nestjs/testing';
import {
  UnauthorizedException,
  ConflictException,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Role, VerificationTokenType, BillingInterval, Industry, WorkspaceType } from '@prisma/client';
import { AuthService } from './auth.service';
import type { CompleteProfileDto } from './dto/complete-profile.dto';
import { CURRENT_TERMS_VERSION } from '../common/constants/terms.constants';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../modules/mail/mail.service';
import { NurturingService } from '../modules/nurturing/nurturing.service';
import { BillingService } from '../modules/billing/billing.service';
import { LeadsService } from '../modules/leads/leads.service';
import { ManufacturingDefaultsService } from '../modules/manufacturing-defaults/manufacturing-defaults.service';
import { MfaService } from './mfa.service';
import { SessionTokenService } from './session-token.service';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

jest.mock('bcrypt');
const bcryptCompare = bcrypt.compare as jest.Mock;
const bcryptHash = bcrypt.hash as jest.Mock;

const mockTransaction = jest.fn();
const mockNurturing = { createDefaultWelcomeSequence: jest.fn().mockResolvedValue(undefined) };

const mockPrisma = {
  user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), findMany: jest.fn() },
  organization: { findUnique: jest.fn(), create: jest.fn() },
  oAuthAccount: { findUnique: jest.fn(), create: jest.fn(), findMany: jest.fn(), deleteMany: jest.fn() },
  verificationToken: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    deleteMany: jest.fn(),
  },
  auditLog: { create: jest.fn() },
  $transaction: mockTransaction,
};

const mockJwt = { sign: jest.fn().mockReturnValue('signed-token') };
const mockMail = { send: jest.fn().mockResolvedValue(true) };
const mockBilling = {
  createSubscriptionForNewOrg: jest.fn(),
  confirmPaymentForOrg: jest.fn(),
};
const mockLeads = { captureWebsiteSignupLead: jest.fn().mockResolvedValue(undefined) };
const mockManufacturingDefaults = { seedForOrgSafely: jest.fn().mockResolvedValue(undefined) };
const mockMfa = {
  initSetupForUser: jest.fn().mockResolvedValue({ setupToken: 'setup-token', qrCodeDataUrl: 'data:...', secret: 'SECRET' }),
};
const mockSessionToken = { mint: jest.fn().mockResolvedValue('signed-token') };

const activeUser = {
  id: 'user-1',
  name: 'Test User',
  email: 'test@example.com',
  passwordHash: '$hashed',
  role: Role.SALES_REP,
  teamId: 'team-1',
  isActive: true,
  emailVerified: true,
};

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockSessionToken.mint.mockResolvedValue('signed-token');
    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwt },
        { provide: MailService, useValue: mockMail },
        { provide: NurturingService, useValue: mockNurturing },
        { provide: BillingService, useValue: mockBilling },
        { provide: LeadsService, useValue: mockLeads },
        { provide: ManufacturingDefaultsService, useValue: mockManufacturingDefaults },
        { provide: MfaService, useValue: mockMfa },
        { provide: SessionTokenService, useValue: mockSessionToken },
      ],
    }).compile();
    service = module.get(AuthService);
  });

  describe('login', () => {
    it('returns token and user on valid credentials', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(activeUser);
      bcryptCompare.mockResolvedValue(true);
      const result = (await service.login({ email: 'test@example.com', password: 'Password@123' })) as {
        token: string;
        user: Record<string, unknown>;
      };
      expect(result.token).toBe('signed-token');
      expect(result.user).toMatchObject({ id: 'user-1', email: 'test@example.com', role: Role.SALES_REP });
      expect(result.user).not.toHaveProperty('passwordHash');
    });

    it('includes org.workspaceType in the returned user, not just orgId', async () => {
      // Regression: login() used to omit `org` entirely, so a Manufacturing org's own
      // sidebar nav fell back to EdTech right after signing in (user.org.workspaceType
      // was undefined until a later getMe() refetch).
      mockPrisma.user.findUnique.mockResolvedValue({
        ...activeUser,
        orgId: 'org-1',
        org: { id: 'org-1', name: 'Acme Mfg', workspaceType: 'MANUFACTURING', planStatus: 'TRIAL' },
      });
      bcryptCompare.mockResolvedValue(true);
      const result = (await service.login({ email: 'test@example.com', password: 'Password@123' })) as {
        user: Record<string, unknown>;
      };
      expect(result.user.org).toMatchObject({ id: 'org-1', workspaceType: 'MANUFACTURING' });
    });

    it('includes mfgRole in the returned user so the client can gate by Manufacturing role', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...activeUser, mfgRole: 'SALES_HEAD' });
      bcryptCompare.mockResolvedValue(true);
      const result = (await service.login({ email: 'test@example.com', password: 'Password@123' })) as {
        user: Record<string, unknown>;
      };
      expect(result.user.mfgRole).toBe('SALES_HEAD');
    });

    it('throws UnauthorizedException when user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.login({ email: 'bad@example.com', password: 'pass' })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException when user is inactive', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...activeUser, isActive: false });
      await expect(service.login({ email: 'test@example.com', password: 'pass' })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException on wrong password', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(activeUser);
      bcryptCompare.mockResolvedValue(false);
      await expect(service.login({ email: 'test@example.com', password: 'wrong' })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException when account uses SSO (no passwordHash)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...activeUser, passwordHash: null });
      await expect(service.login({ email: 'test@example.com', password: 'pass' })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('records an audit log entry on successful login', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(activeUser);
      bcryptCompare.mockResolvedValue(true);
      await service.login({ email: 'test@example.com', password: 'Password@123' });
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'user-1', action: 'LOGIN', entity: 'User' }),
        }),
      );
    });

    it('signs JWT with correct payload', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(activeUser);
      bcryptCompare.mockResolvedValue(true);
      await service.login({ email: 'test@example.com', password: 'pass' });
      expect(mockSessionToken.mint).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'user-1', email: 'test@example.com', role: Role.SALES_REP }),
      );
    });

    it('surfaces mustChangePassword in the returned user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...activeUser, mustChangePassword: true });
      bcryptCompare.mockResolvedValue(true);
      const result = (await service.login({ email: 'test@example.com', password: 'pass' })) as {
        user: { mustChangePassword: boolean };
      };
      expect(result.user.mustChangePassword).toBe(true);
    });

    it('returns a challenge token instead of a session when the user has MFA enrolled', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...activeUser, mfaSecret: 'SECRET' });
      bcryptCompare.mockResolvedValue(true);
      mockJwt.sign.mockReturnValueOnce('challenge-jwt');
      const result = await service.login({ email: 'test@example.com', password: 'pass' });
      expect(result).toEqual({ mfaRequired: true, challengeToken: 'challenge-jwt' });
      expect(mockJwt.sign).toHaveBeenCalledWith({ sub: 'user-1', purpose: 'mfa_challenge' }, { expiresIn: '5m' });
    });

    it('returns a setup token instead of a session when the org enforces MFA and the user has not enrolled', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...activeUser, orgId: 'org-1' });
      mockPrisma.organization.findUnique.mockResolvedValue({ securitySettings: { mfaEnforced: true } });
      bcryptCompare.mockResolvedValue(true);
      const result = await service.login({ email: 'test@example.com', password: 'pass' });
      expect(result).toEqual({
        mustSetupMfa: true,
        setupToken: 'setup-token',
        qrCodeDataUrl: 'data:...',
        secret: 'SECRET',
      });
      expect(mockMfa.initSetupForUser).toHaveBeenCalledWith('user-1', 'test@example.com');
    });

    it('logs in normally when the org has no MFA enforcement and the user has not enrolled', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...activeUser, orgId: 'org-1' });
      mockPrisma.organization.findUnique.mockResolvedValue({ securitySettings: { mfaEnforced: false } });
      bcryptCompare.mockResolvedValue(true);
      const result = (await service.login({ email: 'test@example.com', password: 'pass' })) as { token: string };
      expect(result.token).toBe('signed-token');
      expect(mockMfa.initSetupForUser).not.toHaveBeenCalled();
    });
  });

  describe('changePassword', () => {
    it('updates the hash, clears mustChangePassword, and returns a fresh token + user', async () => {
      bcryptHash.mockResolvedValue('$newhash');
      mockPrisma.user.update.mockResolvedValue({
        id: 'user-1', name: 'Test User', email: 'test@example.com', role: Role.SALES_REP, teamId: 'team-1', orgId: 'org-1',
      });
      const result = await service.changePassword('user-1', 'NewPassword@1');
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: expect.objectContaining({ passwordHash: '$newhash', mustChangePassword: false }),
        }),
      );
      expect(result.token).toBe('signed-token');
      expect(result.user.mustChangePassword).toBe(false);
    });
  });

  describe('register', () => {
    const registerDto = {
      name: 'Owner',
      email: 'owner@co.com',
      password: 'Password@123',
      orgName: 'Acme Edu',
      workspaceType: WorkspaceType.EDTECH,
      industry: 'EDTECH' as const,
      orgSize: 'SMALL' as const,
      country: 'India',
      timezone: 'Asia/Kolkata',
      acceptedTerms: true,
    };

    it('sets workspaceType from the dto on the created org', async () => {
      bcryptHash.mockResolvedValue('$hashed');
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.organization.findUnique.mockResolvedValue(null);
      mockTransaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => Promise<unknown>) => {
        const createdUser = { id: 'u1', name: 'Owner', email: 'owner@co.com', role: Role.DIRECTOR, teamId: null };
        mockPrisma.user.create.mockResolvedValue(createdUser);
        mockPrisma.organization.create.mockResolvedValue({ id: 'org1', name: 'Acme Mfg' });
        mockPrisma.user.update.mockResolvedValue({ ...createdUser, orgId: 'org1' });
        return fn(mockPrisma);
      });
      mockPrisma.verificationToken.create.mockResolvedValue({});

      await service.register({ ...registerDto, workspaceType: WorkspaceType.MANUFACTURING, industry: undefined });

      expect(mockPrisma.organization.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            workspaceType: WorkspaceType.MANUFACTURING,
            industry: Industry.MANUFACTURING,
          }),
        }),
      );
    });

    it('seeds Manufacturing defaults (fire-and-forget) when workspaceType is MANUFACTURING', async () => {
      bcryptHash.mockResolvedValue('$hashed');
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.organization.findUnique.mockResolvedValue(null);
      mockTransaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => Promise<unknown>) => {
        const createdUser = { id: 'u1', name: 'Owner', email: 'owner@co.com', role: Role.DIRECTOR, teamId: null };
        mockPrisma.user.create.mockResolvedValue(createdUser);
        mockPrisma.organization.create.mockResolvedValue({ id: 'org1', name: 'Acme Mfg' });
        mockPrisma.user.update.mockResolvedValue({ ...createdUser, orgId: 'org1' });
        return fn(mockPrisma);
      });
      mockPrisma.verificationToken.create.mockResolvedValue({});

      await service.register({ ...registerDto, workspaceType: WorkspaceType.MANUFACTURING, industry: undefined });

      expect(mockManufacturingDefaults.seedForOrgSafely).toHaveBeenCalledWith('org1');
    });

    it('does not seed Manufacturing defaults for an EDTECH org', async () => {
      bcryptHash.mockResolvedValue('$hashed');
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.organization.findUnique.mockResolvedValue(null);
      mockTransaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => Promise<unknown>) => {
        const createdUser = { id: 'u1', name: 'Owner', email: 'owner@co.com', role: Role.DIRECTOR, teamId: null };
        mockPrisma.user.create.mockResolvedValue(createdUser);
        mockPrisma.organization.create.mockResolvedValue({ id: 'org1', name: 'Acme Edu' });
        mockPrisma.user.update.mockResolvedValue({ ...createdUser, orgId: 'org1' });
        return fn(mockPrisma);
      });
      mockPrisma.verificationToken.create.mockResolvedValue({});

      await service.register({ ...registerDto, workspaceType: WorkspaceType.EDTECH });

      expect(mockManufacturingDefaults.seedForOrgSafely).not.toHaveBeenCalled();
    });

    it('honors an explicitly provided industry over the workspaceType-derived default', async () => {
      bcryptHash.mockResolvedValue('$hashed');
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.organization.findUnique.mockResolvedValue(null);
      mockTransaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => Promise<unknown>) => {
        const createdUser = { id: 'u1', name: 'Owner', email: 'owner@co.com', role: Role.DIRECTOR, teamId: null };
        mockPrisma.user.create.mockResolvedValue(createdUser);
        mockPrisma.organization.create.mockResolvedValue({ id: 'org1', name: 'Acme Mfg' });
        mockPrisma.user.update.mockResolvedValue({ ...createdUser, orgId: 'org1' });
        return fn(mockPrisma);
      });
      mockPrisma.verificationToken.create.mockResolvedValue({});

      await service.register({
        ...registerDto,
        workspaceType: WorkspaceType.MANUFACTURING,
        industry: Industry.OTHER,
      });

      expect(mockPrisma.organization.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ industry: Industry.OTHER }) }),
      );
    });

    it('defaults workspaceType to EDTECH when omitted from the dto (backward compat)', async () => {
      bcryptHash.mockResolvedValue('$hashed');
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.organization.findUnique.mockResolvedValue(null);
      mockTransaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => Promise<unknown>) => {
        const createdUser = { id: 'u1', name: 'Owner', email: 'owner@co.com', role: Role.DIRECTOR, teamId: null };
        mockPrisma.user.create.mockResolvedValue(createdUser);
        mockPrisma.organization.create.mockResolvedValue({ id: 'org1', name: 'Acme Edu' });
        mockPrisma.user.update.mockResolvedValue({ ...createdUser, orgId: 'org1' });
        return fn(mockPrisma);
      });
      mockPrisma.verificationToken.create.mockResolvedValue({});

      const { workspaceType: _omit, ...dtoWithoutWorkspaceType } = registerDto;
      await service.register(dtoWithoutWorkspaceType);

      expect(mockPrisma.organization.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ workspaceType: WorkspaceType.EDTECH }),
        }),
      );
    });

    it('creates a DIRECTOR + org without auto-login token', async () => {
      bcryptHash.mockResolvedValue('$hashed');
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.organization.findUnique.mockResolvedValue(null);
      mockTransaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => Promise<unknown>) => {
        const createdUser = { id: 'u1', name: 'Owner', email: 'owner@co.com', role: Role.DIRECTOR, teamId: null };
        const createdOrg = {
          id: 'org1',
          name: 'Acme Edu',
          slug: 'acme-edu',
          industry: 'EDTECH',
          size: 'SMALL',
          country: 'India',
          timezone: 'Asia/Kolkata',
        };
        mockPrisma.user.create.mockResolvedValue(createdUser);
        mockPrisma.organization.create.mockResolvedValue(createdOrg);
        mockPrisma.user.update.mockResolvedValue({ ...createdUser, orgId: 'org1' });
        return fn(mockPrisma);
      });
      mockPrisma.verificationToken.create.mockResolvedValue({});
      const result = await service.register(registerDto);
      // No token by design — the user must verify their email before they can sign in.
      expect(result).not.toHaveProperty('token');
      expect(result.user.role).toBe(Role.DIRECTOR);
      expect(result.org.name).toBe('Acme Edu');
      // Verification email is fired fire-and-forget on register; the welcome email is
      // sent later, on verifyEmail() — not here. Flush microtasks so the void-ed
      // issueAndSendVerification() completes before we assert.
      await new Promise((resolve) => setImmediate(resolve));
      expect(mockMail.send).toHaveBeenCalledWith(
        'owner@co.com',
        'Verify your email',
        expect.any(String),
      );
      expect(mockLeads.captureWebsiteSignupLead).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Owner', email: 'owner@co.com', orgName: 'Acme Edu' }),
      );
    });

    it('stamps termsAcceptedAt and the current terms version on the new org', async () => {
      bcryptHash.mockResolvedValue('$hashed');
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.organization.findUnique.mockResolvedValue(null);
      mockTransaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => Promise<unknown>) => {
        const createdUser = { id: 'u1', name: 'Owner', email: 'owner@co.com', role: Role.DIRECTOR, teamId: null };
        const createdOrg = {
          id: 'org1', name: 'Acme Edu', slug: 'acme-edu', industry: 'EDTECH',
          size: 'SMALL', country: 'India', timezone: 'Asia/Kolkata',
        };
        mockPrisma.user.create.mockResolvedValue(createdUser);
        mockPrisma.organization.create.mockResolvedValue(createdOrg);
        mockPrisma.user.update.mockResolvedValue({ ...createdUser, orgId: 'org1' });
        return fn(mockPrisma);
      });
      mockPrisma.verificationToken.create.mockResolvedValue({});

      await service.register(registerDto);

      expect(mockPrisma.organization.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            termsAcceptedAt: expect.any(Date),
            termsVersion: CURRENT_TERMS_VERSION,
          }),
        }),
      );
    });

    it('throws BadRequestException without creating a user when acceptedTerms is false', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.register({ ...registerDto, acceptedTerms: false })).rejects.toThrow(
        BadRequestException,
      );
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });

    it('logs a trailing confirmation when the verification email actually sends', async () => {
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      mockMail.send.mockResolvedValueOnce(true);
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.organization.findUnique.mockResolvedValue(null);
      mockTransaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => Promise<unknown>) => {
        const createdUser = { id: 'u1', name: 'Owner', email: 'owner@co.com', role: Role.DIRECTOR, teamId: null };
        const createdOrg = {
          id: 'org1', name: 'Acme Edu', slug: 'acme-edu', industry: 'EDTECH',
          size: 'SMALL', country: 'India', timezone: 'Asia/Kolkata',
        };
        mockPrisma.user.create.mockResolvedValue(createdUser);
        mockPrisma.organization.create.mockResolvedValue(createdOrg);
        mockPrisma.user.update.mockResolvedValue({ ...createdUser, orgId: 'org1' });
        return fn(mockPrisma);
      });
      mockPrisma.verificationToken.create.mockResolvedValue({});

      await service.register(registerDto);
      await new Promise((resolve) => setImmediate(resolve));

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Verification email sent to owner@co.com'));
      logSpy.mockRestore();
    });

    it('logs a warning (not a false "sent" confirmation) when MailService reports the send failed', async () => {
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      mockMail.send.mockResolvedValueOnce(false);
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.organization.findUnique.mockResolvedValue(null);
      mockTransaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => Promise<unknown>) => {
        const createdUser = { id: 'u1', name: 'Owner', email: 'owner@co.com', role: Role.DIRECTOR, teamId: null };
        const createdOrg = {
          id: 'org1', name: 'Acme Edu', slug: 'acme-edu', industry: 'EDTECH',
          size: 'SMALL', country: 'India', timezone: 'Asia/Kolkata',
        };
        mockPrisma.user.create.mockResolvedValue(createdUser);
        mockPrisma.organization.create.mockResolvedValue(createdOrg);
        mockPrisma.user.update.mockResolvedValue({ ...createdUser, orgId: 'org1' });
        return fn(mockPrisma);
      });
      mockPrisma.verificationToken.create.mockResolvedValue({});

      await service.register(registerDto);
      await new Promise((resolve) => setImmediate(resolve));

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Verification email NOT sent to owner@co.com'));
      expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('Verification email sent to'));
      warnSpy.mockRestore();
      logSpy.mockRestore();
    });

    it('throws ConflictException when email already exists', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(activeUser);
      await expect(service.register(registerDto)).rejects.toThrow(ConflictException);
    });

    it('normalizes email (lowercase + trim) before the duplicate check', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(activeUser);
      await expect(
        service.register({ ...registerDto, email: '  Owner@CO.com ' }),
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'owner@co.com' },
      });
    });

    const setupTransaction = () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.organization.findUnique.mockResolvedValue(null);
      mockTransaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => Promise<unknown>) => {
        const createdUser = { id: 'u1', name: 'Owner', email: 'owner@co.com', role: Role.DIRECTOR, teamId: null };
        const createdOrg = {
          id: 'org1',
          name: 'Acme Edu',
          slug: 'acme-edu',
          industry: 'EDTECH',
          size: 'SMALL',
          country: 'India',
          timezone: 'Asia/Kolkata',
        };
        mockPrisma.user.create.mockResolvedValue(createdUser);
        mockPrisma.organization.create.mockResolvedValue(createdOrg);
        mockPrisma.user.update.mockResolvedValue({ ...createdUser, orgId: 'org1' });
        return fn(mockPrisma);
      });
      mockPrisma.verificationToken.create.mockResolvedValue({});
    };

    it('does not start a subscription for a trial (or omitted) plan', async () => {
      bcryptHash.mockResolvedValue('$hashed');
      setupTransaction();
      const result = await service.register({ ...registerDto, selectedPlanId: 'trial' });
      expect(mockBilling.createSubscriptionForNewOrg).not.toHaveBeenCalled();
      expect(result.subscriptionId).toBeUndefined();
    });

    it('starts a Razorpay subscription for a paid plan and returns checkout info', async () => {
      bcryptHash.mockResolvedValue('$hashed');
      setupTransaction();
      mockBilling.createSubscriptionForNewOrg.mockResolvedValue({
        subscriptionId: 'rzp_sub_1',
        razorpayKeyId: 'rzp_key',
      });
      const result = await service.register({
        ...registerDto,
        selectedPlanId: 'plan-growth',
        billingInterval: BillingInterval.MONTHLY,
        seats: 5,
        couponCode: 'WELCOME20',
      });
      expect(mockBilling.createSubscriptionForNewOrg).toHaveBeenCalledWith(
        'org1',
        'plan-growth',
        5,
        BillingInterval.MONTHLY,
        'WELCOME20',
      );
      expect(result.subscriptionId).toBe('rzp_sub_1');
      expect(result.razorpayKeyId).toBe('rzp_key');
      expect(result.billingSetupFailed).toBe(false);
    });

    it('flags billingSetupFailed rather than throwing when Razorpay setup fails', async () => {
      bcryptHash.mockResolvedValue('$hashed');
      setupTransaction();
      mockBilling.createSubscriptionForNewOrg.mockRejectedValue(new Error('razorpay down'));
      const result = await service.register({ ...registerDto, selectedPlanId: 'plan-growth' });
      expect(result.billingSetupFailed).toBe(true);
      expect(result.user.role).toBe(Role.DIRECTOR);
    });
  });

  describe('confirmRegistrationPayment', () => {
    const SECRET = 'rzp-secret';
    const sign = (paymentId: string, subId: string, secret = SECRET) =>
      crypto.createHmac('sha256', secret).update(`${paymentId}|${subId}`).digest('hex');

    beforeEach(() => {
      process.env.RAZORPAY_KEY_SECRET = SECRET;
    });
    afterEach(() => {
      delete process.env.RAZORPAY_KEY_SECRET;
    });

    const org = {
      id: 'org-1',
      owner: {
        id: 'user-1',
        name: 'Owner',
        email: 'owner@co.com',
        role: Role.DIRECTOR,
        teamId: null,
        emailVerified: false,
        mustChangePassword: false,
      },
    };

    it('rejects an invalid signature without touching billing', async () => {
      await expect(
        service.confirmRegistrationPayment({
          orgId: 'org-1',
          razorpayPaymentId: 'pay_1',
          razorpaySubscriptionId: 'sub_1',
          razorpaySignature: 'not-the-real-signature',
        }),
      ).rejects.toThrow(UnauthorizedException);
      expect(mockBilling.confirmPaymentForOrg).not.toHaveBeenCalled();
    });

    it('activates billing, verifies the email, and mints a token on a valid signature', async () => {
      mockBilling.confirmPaymentForOrg.mockResolvedValue({ status: 'activated' });
      mockPrisma.organization.findUnique.mockResolvedValue(org);
      const result = await service.confirmRegistrationPayment({
        orgId: 'org-1',
        razorpayPaymentId: 'pay_1',
        razorpaySubscriptionId: 'sub_1',
        razorpaySignature: sign('pay_1', 'sub_1'),
      });
      expect(mockBilling.confirmPaymentForOrg).toHaveBeenCalledWith('org-1', 'pay_1', 'sub_1');
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: expect.objectContaining({ emailVerified: true }),
        }),
      );
      expect(result.token).toBe('signed-token');
      expect(result.user).toMatchObject({ id: 'user-1', email: 'owner@co.com', orgId: 'org-1' });
    });

    it('throws NotFoundException when the org no longer exists', async () => {
      mockBilling.confirmPaymentForOrg.mockResolvedValue({ status: 'activated' });
      mockPrisma.organization.findUnique.mockResolvedValue(null);
      await expect(
        service.confirmRegistrationPayment({
          orgId: 'org-1',
          razorpayPaymentId: 'pay_1',
          razorpaySubscriptionId: 'sub_1',
          razorpaySignature: sign('pay_1', 'sub_1'),
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findOrCreateFromOAuth', () => {
    const oauthProfile = {
      provider: 'google' as const,
      providerId: 'goog-123',
      email: 'oauth@example.com',
      name: 'OAuth User',
    };

    it('returns token and needsOrgSetup=false for existing account with org', async () => {
      const existingUser = { ...activeUser, orgId: 'org-1' };
      mockPrisma.oAuthAccount.findUnique.mockResolvedValue({ user: existingUser });
      const result = (await service.findOrCreateFromOAuth(oauthProfile)) as { token: string; needsOrgSetup: boolean };
      expect(result.token).toBe('signed-token');
      expect(result.needsOrgSetup).toBe(false);
    });

    it('returns needsOrgSetup=true for existing account without org', async () => {
      mockPrisma.oAuthAccount.findUnique.mockResolvedValue({ user: { ...activeUser, orgId: null } });
      const result = (await service.findOrCreateFromOAuth(oauthProfile)) as { needsOrgSetup: boolean };
      expect(result.needsOrgSetup).toBe(true);
    });

    it('returns a challenge token instead of a session when a returning SSO user has MFA enrolled', async () => {
      const existingUser = { ...activeUser, orgId: 'org-1', mfaSecret: 'SECRET' };
      mockPrisma.oAuthAccount.findUnique.mockResolvedValue({ user: existingUser });
      mockJwt.sign.mockReturnValueOnce('challenge-jwt');
      const result = await service.findOrCreateFromOAuth(oauthProfile);
      expect(result).toEqual({ mfaRequired: true, challengeToken: 'challenge-jwt' });
      expect(mockJwt.sign).toHaveBeenCalledWith({ sub: existingUser.id, purpose: 'mfa_challenge' }, { expiresIn: '5m' });
      expect(mockPrisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('returns a setup token when the org enforces MFA and the returning SSO user has not enrolled', async () => {
      const existingUser = { ...activeUser, orgId: 'org-1' };
      mockPrisma.oAuthAccount.findUnique.mockResolvedValue({ user: existingUser });
      mockPrisma.organization.findUnique.mockResolvedValueOnce({ securitySettings: { mfaEnforced: true } });
      const result = await service.findOrCreateFromOAuth(oauthProfile);
      expect(result).toEqual({
        mustSetupMfa: true,
        setupToken: 'setup-token',
        qrCodeDataUrl: 'data:...',
        secret: 'SECRET',
      });
      expect(mockMfa.initSetupForUser).toHaveBeenCalledWith(existingUser.id, existingUser.email);
      expect(mockPrisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('gates MFA when linking a new OAuthAccount to an existing (by email) user who already has MFA enrolled', async () => {
      mockPrisma.oAuthAccount.findUnique.mockResolvedValue(null);
      mockPrisma.user.findUnique.mockResolvedValue({ ...activeUser, orgId: 'org-1', mfaSecret: 'SECRET' });
      mockPrisma.oAuthAccount.create.mockResolvedValue({});
      mockJwt.sign.mockReturnValueOnce('challenge-jwt');
      const result = await service.findOrCreateFromOAuth(oauthProfile);
      expect(result).toEqual({ mfaRequired: true, challengeToken: 'challenge-jwt' });
    });

    it('audit-logs a LOGIN for a returning SSO user', async () => {
      const existingUser = { ...activeUser, orgId: 'org-1' };
      mockPrisma.oAuthAccount.findUnique.mockResolvedValue({ user: existingUser });
      await service.findOrCreateFromOAuth(oauthProfile);
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: { userId: existingUser.id, action: 'LOGIN', entity: 'User', entityId: existingUser.id },
      });
    });

    it('creates user and oAuthAccount when neither exists, without audit-logging the signup as a login', async () => {
      mockPrisma.oAuthAccount.findUnique.mockResolvedValue(null);
      mockPrisma.user.findUnique.mockResolvedValue(null);
      const newUser = { id: 'u-new', name: 'OAuth User', email: 'oauth@example.com', role: Role.DIRECTOR, orgId: null };
      mockPrisma.user.create.mockResolvedValue(newUser);
      mockPrisma.oAuthAccount.create.mockResolvedValue({});
      const result = (await service.findOrCreateFromOAuth(oauthProfile)) as { needsOrgSetup: boolean };
      expect(mockPrisma.user.create).toHaveBeenCalled();
      expect(mockPrisma.oAuthAccount.create).toHaveBeenCalled();
      expect(result.needsOrgSetup).toBe(true);
      expect(mockPrisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('links oAuthAccount to existing user with matching email', async () => {
      mockPrisma.oAuthAccount.findUnique.mockResolvedValue(null);
      mockPrisma.user.findUnique.mockResolvedValue({ ...activeUser, orgId: 'org-1' });
      mockPrisma.oAuthAccount.create.mockResolvedValue({});
      const result = (await service.findOrCreateFromOAuth(oauthProfile)) as { needsOrgSetup: boolean };
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
      expect(mockPrisma.oAuthAccount.create).toHaveBeenCalled();
      expect(result.needsOrgSetup).toBe(false);
    });

    it('throws UnauthorizedException when profile has no email', async () => {
      await expect(service.findOrCreateFromOAuth({ ...oauthProfile, email: '' })).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('completeProfile', () => {
    const dto = {
      orgName: 'Acme Edu',
      workspaceType: WorkspaceType.EDTECH,
      industry: 'EDTECH' as const,
      orgSize: 'SMALL' as const,
      country: 'India',
      timezone: 'Asia/Kolkata',
      acceptedTerms: true,
    };

    it('throws NotFoundException when user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.completeProfile('user-1', dto)).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when user already has an org', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...activeUser, orgId: 'org-1' });
      await expect(service.completeProfile('user-1', dto)).rejects.toThrow(ConflictException);
    });

    it('creates org, updates user, and returns fresh token', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...activeUser, orgId: null });
      mockPrisma.organization.findUnique.mockResolvedValue(null);
      const newOrg = { id: 'org-new', name: 'Acme Edu', planStatus: 'TRIAL', trialEndsAt: new Date() };
      mockTransaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => Promise<unknown>) => {
        mockPrisma.organization.create.mockResolvedValue(newOrg);
        mockPrisma.user.update.mockResolvedValue({});
        return fn(mockPrisma);
      });
      const result = await service.completeProfile('user-1', dto);
      expect(result.token).toBe('signed-token');
      expect(result.org.name).toBe('Acme Edu');
    });

    it('sets workspaceType from the dto and derives industry when omitted', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@b.com', role: Role.DIRECTOR, orgId: null });
      mockPrisma.organization.findUnique.mockResolvedValue(null);
      const newOrg = { id: 'org1', name: 'Acme Mfg', planStatus: 'TRIAL', trialEndsAt: new Date() };
      mockTransaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => Promise<unknown>) => {
        mockPrisma.organization.create.mockResolvedValue(newOrg);
        mockPrisma.user.update.mockResolvedValue({});
        return fn(mockPrisma);
      });

      await service.completeProfile('u1', {
        orgName: 'Acme Mfg',
        acceptedTerms: true,
        workspaceType: WorkspaceType.MANUFACTURING,
        orgSize: 'SMALL',
        country: 'India',
        timezone: 'Asia/Kolkata',
      } as CompleteProfileDto);

      expect(mockPrisma.organization.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            workspaceType: WorkspaceType.MANUFACTURING,
            industry: Industry.MANUFACTURING,
          }),
        }),
      );
    });

    it('seeds Manufacturing defaults (fire-and-forget) when workspaceType is MANUFACTURING', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@b.com', role: Role.DIRECTOR, orgId: null });
      mockPrisma.organization.findUnique.mockResolvedValue(null);
      const newOrg = { id: 'org1', name: 'Acme Mfg', planStatus: 'TRIAL', trialEndsAt: new Date() };
      mockTransaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => Promise<unknown>) => {
        mockPrisma.organization.create.mockResolvedValue(newOrg);
        mockPrisma.user.update.mockResolvedValue({});
        return fn(mockPrisma);
      });

      await service.completeProfile('u1', {
        orgName: 'Acme Mfg',
        acceptedTerms: true,
        workspaceType: WorkspaceType.MANUFACTURING,
        orgSize: 'SMALL',
        country: 'India',
        timezone: 'Asia/Kolkata',
      } as CompleteProfileDto);

      expect(mockManufacturingDefaults.seedForOrgSafely).toHaveBeenCalledWith('org1');
    });

    it('does not seed Manufacturing defaults for an EDTECH org', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@b.com', role: Role.DIRECTOR, orgId: null });
      mockPrisma.organization.findUnique.mockResolvedValue(null);
      const newOrg = { id: 'org1', name: 'Acme Edu', planStatus: 'TRIAL', trialEndsAt: new Date() };
      mockTransaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => Promise<unknown>) => {
        mockPrisma.organization.create.mockResolvedValue(newOrg);
        mockPrisma.user.update.mockResolvedValue({});
        return fn(mockPrisma);
      });

      await service.completeProfile('u1', {
        orgName: 'Acme Edu',
        acceptedTerms: true,
        workspaceType: WorkspaceType.EDTECH,
        orgSize: 'SMALL',
        country: 'India',
        timezone: 'Asia/Kolkata',
      } as CompleteProfileDto);

      expect(mockManufacturingDefaults.seedForOrgSafely).not.toHaveBeenCalled();
    });

    it('defaults workspaceType to EDTECH when omitted from the dto (backward compat)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@b.com', role: Role.DIRECTOR, orgId: null });
      mockPrisma.organization.findUnique.mockResolvedValue(null);
      const newOrg = { id: 'org1', name: 'Acme Edu', planStatus: 'TRIAL', trialEndsAt: new Date() };
      mockTransaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => Promise<unknown>) => {
        mockPrisma.organization.create.mockResolvedValue(newOrg);
        mockPrisma.user.update.mockResolvedValue({});
        return fn(mockPrisma);
      });

      await service.completeProfile('u1', {
        orgName: 'Acme Edu',
        acceptedTerms: true,
        orgSize: 'SMALL',
        country: 'India',
        timezone: 'Asia/Kolkata',
      } as CompleteProfileDto);

      expect(mockPrisma.organization.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ workspaceType: WorkspaceType.EDTECH }),
        }),
      );
    });

    it('stamps termsAcceptedAt and the current terms version on the new org', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...activeUser, orgId: null });
      mockPrisma.organization.findUnique.mockResolvedValue(null);
      const newOrg = { id: 'org-new', name: 'Acme Edu', planStatus: 'TRIAL', trialEndsAt: new Date() };
      mockTransaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => Promise<unknown>) => {
        mockPrisma.organization.create.mockResolvedValue(newOrg);
        mockPrisma.user.update.mockResolvedValue({});
        return fn(mockPrisma);
      });

      await service.completeProfile('user-1', dto);

      expect(mockPrisma.organization.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            termsAcceptedAt: expect.any(Date),
            termsVersion: CURRENT_TERMS_VERSION,
          }),
        }),
      );
    });

    it('throws BadRequestException without creating an org when acceptedTerms is false', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...activeUser, orgId: null });
      await expect(
        service.completeProfile('user-1', { ...dto, acceptedTerms: false }),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.organization.create).not.toHaveBeenCalled();
    });
  });

  describe('me', () => {
    it('returns user by id without passwordHash', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(activeUser);
      const result = await service.me('user-1');
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'user-1' } }));
      expect(result).toBeDefined();
    });

    it('selects mustChangePassword so the client can gate first-login', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(activeUser);
      await service.me('user-1');
      const call = mockPrisma.user.findUnique.mock.calls[0][0] as { select: Record<string, unknown> };
      expect(call.select.mustChangePassword).toBe(true);
    });

    it('includes the org website and flags the platform org (GenXCRM own org)', async () => {
      const prev = process.env.GENXCRM_INTERNAL_ORG_ID;
      process.env.GENXCRM_INTERNAL_ORG_ID = 'org-internal';
      try {
        mockPrisma.user.findUnique.mockResolvedValue({
          ...activeUser,
          org: { id: 'org-internal', name: 'GenX CRM', website: 'https://genxcrm.co.in' },
        });
        const internal = await service.me('user-1');
        const call = mockPrisma.user.findUnique.mock.calls[0][0] as { select: { org: { select: Record<string, unknown> } } };
        expect(call.select.org.select.website).toBe(true);
        expect(internal?.org).toMatchObject({ website: 'https://genxcrm.co.in', isPlatformOrg: true });

        mockPrisma.user.findUnique.mockResolvedValue({ ...activeUser, org: { id: 'org-other', name: 'Acme' } });
        const other = await service.me('user-1');
        expect(other?.org).toMatchObject({ isPlatformOrg: false });
      } finally {
        if (prev === undefined) delete process.env.GENXCRM_INTERNAL_ORG_ID;
        else process.env.GENXCRM_INTERNAL_ORG_ID = prev;
      }
    });

    it('selects mfgRole so the client can gate by Manufacturing role', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(activeUser);
      await service.me('user-1');
      const call = mockPrisma.user.findUnique.mock.calls[0][0] as { select: Record<string, unknown> };
      expect(call.select.mfgRole).toBe(true);
    });

    it('includes workspaceType in the org select', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(activeUser);
      await service.me('user-1');
      const call = mockPrisma.user.findUnique.mock.calls[0][0] as { select: { org: { select: Record<string, unknown> } } };
      expect(call.select.org.select.workspaceType).toBe(true);
    });
  });

  describe('login email-verification gate', () => {
    // Clear before AND after each case so these tests are hermetic regardless of any
    // AUTH_REQUIRE_VERIFIED_EMAIL value loaded from .env into the ambient environment.
    beforeEach(() => {
      delete process.env.AUTH_REQUIRE_VERIFIED_EMAIL;
    });
    afterEach(() => {
      delete process.env.AUTH_REQUIRE_VERIFIED_EMAIL;
    });

    it('throws by default when user is unverified', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...activeUser, emailVerified: false });
      bcryptCompare.mockResolvedValue(true);
      await expect(service.login({ email: 'test@example.com', password: 'pass' })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('allows unverified login only when AUTH_REQUIRE_VERIFIED_EMAIL=false', async () => {
      process.env.AUTH_REQUIRE_VERIFIED_EMAIL = 'false';
      mockPrisma.user.findUnique.mockResolvedValue({ ...activeUser, emailVerified: false });
      bcryptCompare.mockResolvedValue(true);
      const result = (await service.login({ email: 'test@example.com', password: 'pass' })) as { token: string };
      expect(result.token).toBe('signed-token');
    });
  });

  describe('verifyEmail', () => {
    it('flips emailVerified and marks token used', async () => {
      mockPrisma.verificationToken.findUnique.mockResolvedValue({
        id: 'tok-1',
        userId: 'user-1',
        type: VerificationTokenType.VERIFY_EMAIL,
        usedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      });
      mockTransaction.mockResolvedValue([
        { name: 'Test User', email: 'test@example.com', org: { name: 'Acme Edu' } },
      ]);
      const result = await service.verifyEmail('raw-token');
      expect(result).toEqual({ verified: true });
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: expect.objectContaining({ emailVerified: true }),
        }),
      );
      expect(mockPrisma.verificationToken.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'tok-1' }, data: expect.objectContaining({ usedAt: expect.any(Date) }) }),
      );
      // Welcome email is sent only after the email is verified (fire-and-forget).
      expect(mockMail.send).toHaveBeenCalledWith(
        'test@example.com',
        'Welcome to GenXCRM',
        expect.any(String),
      );
    });

    it('throws BadRequestException for an unknown token', async () => {
      mockPrisma.verificationToken.findUnique.mockResolvedValue(null);
      await expect(service.verifyEmail('bad')).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for an expired token', async () => {
      mockPrisma.verificationToken.findUnique.mockResolvedValue({
        id: 'tok-1',
        userId: 'user-1',
        type: VerificationTokenType.VERIFY_EMAIL,
        usedAt: null,
        expiresAt: new Date(Date.now() - 60_000),
      });
      await expect(service.verifyEmail('raw')).rejects.toThrow(BadRequestException);
    });
  });

  describe('resendVerification', () => {
    it('issues a token for an existing unverified user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...activeUser, emailVerified: false });
      mockPrisma.verificationToken.create.mockResolvedValue({});
      await service.resendVerification('test@example.com');
      expect(mockPrisma.verificationToken.create).toHaveBeenCalled();
    });

    it('resolves without issuing a token for an unknown email', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.resendVerification('nobody@example.com')).resolves.toBeUndefined();
      expect(mockPrisma.verificationToken.create).not.toHaveBeenCalled();
    });

    it('normalizes case/whitespace before lookup so it still finds the user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...activeUser, emailVerified: false });
      mockPrisma.verificationToken.create.mockResolvedValue({});
      await service.resendVerification('  Test@Example.com  ');
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'test@example.com' } });
      expect(mockPrisma.verificationToken.create).toHaveBeenCalled();
    });
  });

  describe('forgotPassword', () => {
    it('resolves for an unknown email without creating a token (no enumeration)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.forgotPassword('nobody@example.com')).resolves.toBeUndefined();
      expect(mockPrisma.verificationToken.create).not.toHaveBeenCalled();
    });

    it('normalizes case/whitespace before lookup so it still finds the user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(activeUser);
      mockPrisma.verificationToken.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.verificationToken.create.mockResolvedValue({});
      await service.forgotPassword('  Test@Example.com  ');
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'test@example.com' } });
      expect(mockPrisma.verificationToken.create).toHaveBeenCalled();
    });

    it('also issues a reset token for SSO-only users, so they can set a password', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...activeUser, passwordHash: null });
      mockPrisma.verificationToken.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.verificationToken.create.mockResolvedValue({});
      await service.forgotPassword('test@example.com');
      expect(mockPrisma.verificationToken.create).toHaveBeenCalled();
      expect(mockMail.send).toHaveBeenCalled();
    });

    it('issues a reset token and emails the link for a password user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(activeUser);
      mockPrisma.verificationToken.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.verificationToken.create.mockResolvedValue({});
      await service.forgotPassword('test@example.com');
      expect(mockPrisma.verificationToken.deleteMany).toHaveBeenCalled();
      expect(mockPrisma.verificationToken.create).toHaveBeenCalled();
      expect(mockMail.send).toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    it('updates passwordHash and marks token used in one transaction', async () => {
      mockPrisma.verificationToken.findUnique.mockResolvedValue({
        id: 'tok-1',
        userId: 'user-1',
        type: VerificationTokenType.PASSWORD_RESET,
        usedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      });
      bcryptHash.mockResolvedValue('$newhash');
      mockTransaction.mockResolvedValue([]);
      mockPrisma.user.findUnique.mockResolvedValue(activeUser);
      await service.resetPassword('raw', 'NewPassword@1');
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: { passwordHash: '$newhash', emailVerified: true, emailVerifiedAt: expect.any(Date) },
        }),
      );
      expect(mockPrisma.verificationToken.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'tok-1' }, data: expect.objectContaining({ usedAt: expect.any(Date) }) }),
      );
    });

    it('rejects an unknown token', async () => {
      mockPrisma.verificationToken.findUnique.mockResolvedValue(null);
      await expect(service.resetPassword('bad', 'NewPassword@1')).rejects.toThrow(BadRequestException);
    });

    it('rejects an already-used token', async () => {
      mockPrisma.verificationToken.findUnique.mockResolvedValue({
        id: 'tok-1',
        userId: 'user-1',
        type: VerificationTokenType.PASSWORD_RESET,
        usedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      });
      await expect(service.resetPassword('raw', 'NewPassword@1')).rejects.toThrow(BadRequestException);
    });

    it('rejects an expired token', async () => {
      mockPrisma.verificationToken.findUnique.mockResolvedValue({
        id: 'tok-1',
        userId: 'user-1',
        type: VerificationTokenType.PASSWORD_RESET,
        usedAt: null,
        expiresAt: new Date(Date.now() - 60_000),
      });
      await expect(service.resetPassword('raw', 'NewPassword@1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('deleteFacebookData', () => {
    const SECRET = 'test-sso-secret';

    // Builds a valid Facebook signed_request: base64url(sig).base64url(payload).
    const signedRequest = (payload: object, secret = SECRET): string => {
      const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const sig = crypto.createHmac('sha256', secret).update(encodedPayload).digest('base64url');
      return `${sig}.${encodedPayload}`;
    };

    beforeEach(() => {
      process.env.FACEBOOK_SSO_APP_SECRET = SECRET;
      mockTransaction.mockResolvedValue([]);
    });
    afterEach(() => {
      delete process.env.FACEBOOK_SSO_APP_SECRET;
    });

    it('erases linked accounts and returns url + confirmation_code', async () => {
      mockPrisma.oAuthAccount.findMany.mockResolvedValue([{ userId: 'user-1' }]);
      const req = signedRequest({ user_id: 'fb-123', algorithm: 'HMAC-SHA256' });

      const result = await service.deleteFacebookData(req);

      expect(mockPrisma.oAuthAccount.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { provider: 'facebook', providerId: 'fb-123' } }),
      );
      // OAuth link severed + PII scrubbed inside one transaction.
      expect(mockPrisma.oAuthAccount.deleteMany).toHaveBeenCalledWith({
        where: { provider: 'facebook', providerId: 'fb-123' },
      });
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: expect.objectContaining({ phone: null, passwordHash: null, isActive: false }),
        }),
      );
      expect(mockTransaction).toHaveBeenCalled();
      expect(result.confirmation_code).toMatch(/^[a-f0-9]{24}$/);
      expect(result.url).toContain(`code=${result.confirmation_code}`);
    });

    it('is idempotent when no account is linked (no transaction, still confirms)', async () => {
      mockPrisma.oAuthAccount.findMany.mockResolvedValue([]);
      const result = await service.deleteFacebookData(signedRequest({ user_id: 'fb-unknown' }));
      expect(mockTransaction).not.toHaveBeenCalled();
      expect(result.confirmation_code).toBeTruthy();
    });

    it('rejects a signed_request with a bad signature', async () => {
      const tampered = signedRequest({ user_id: 'fb-123' }, 'wrong-secret');
      await expect(service.deleteFacebookData(tampered)).rejects.toThrow(BadRequestException);
    });

    it('rejects a malformed signed_request', async () => {
      await expect(service.deleteFacebookData('not-a-signed-request')).rejects.toThrow(BadRequestException);
    });

    it('rejects when the payload has no user_id', async () => {
      await expect(service.deleteFacebookData(signedRequest({ algorithm: 'HMAC-SHA256' }))).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('impersonate', () => {
    const caller = {
      id: 'director-1',
      name: 'Director',
      email: 'chinta.rahul2@gmail.com',
      role: Role.DIRECTOR,
      teamId: null,
      orgId: 'org-1',
    };

    const target = {
      id: 'rep-1',
      name: 'Rep',
      email: 'rep@example.com',
      role: Role.SALES_REP,
      teamId: 'team-1',
      orgId: 'org-1',
    };

    it('rejects a caller whose email is not on the allowlist', async () => {
      const nonAllowlisted = { ...caller, email: 'someone-else@example.com' };
      await expect(service.impersonate('rep-1', nonAllowlisted)).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('rejects impersonating yourself', async () => {
      await expect(service.impersonate('director-1', caller)).rejects.toThrow(BadRequestException);
    });

    it('rejects when the caller is already impersonating (no chaining)', async () => {
      const alreadyImpersonating = { ...caller, impersonatedBy: 'someone' };
      await expect(service.impersonate('rep-1', alreadyImpersonating)).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when the target does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.impersonate('rep-1', caller)).rejects.toThrow(NotFoundException);
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'rep-1' } }),
      );
    });

    it('signs a token carrying impersonatedBy and logs the start event', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(target);
      mockPrisma.auditLog.create.mockResolvedValue({});
      const result = await service.impersonate('rep-1', caller);

      expect(mockSessionToken.mint).toHaveBeenCalledWith({
        id: 'rep-1',
        email: 'rep@example.com',
        role: Role.SALES_REP,
        orgId: 'org-1',
        impersonatedBy: 'director-1',
      });
      expect(result.token).toBe('signed-token');
      expect(result.user).toMatchObject({ id: 'rep-1', email: 'rep@example.com' });
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: { userId: 'director-1', action: 'IMPERSONATE_START', entity: 'User', entityId: 'rep-1' },
      });
    });

    it('allows impersonating a user in a different org (system-wide, not tenant-scoped)', async () => {
      const otherOrgTarget = { ...target, id: 'rep-2', orgId: 'org-2' };
      mockPrisma.user.findUnique.mockResolvedValue(otherOrgTarget);
      mockPrisma.auditLog.create.mockResolvedValue({});
      const result = await service.impersonate('rep-2', caller);
      expect(result.user).toMatchObject({ id: 'rep-2', orgId: 'org-2' });
    });
  });

  describe('listImpersonatableUsers', () => {
    const caller = {
      id: 'director-1',
      name: 'Director',
      email: 'chinta.rahul2@gmail.com',
      role: Role.DIRECTOR,
      teamId: null,
      orgId: 'org-1',
    };

    it('rejects a caller whose email is not on the allowlist', async () => {
      const nonAllowlisted = { ...caller, email: 'someone-else@example.com' };
      await expect(service.listImpersonatableUsers(nonAllowlisted)).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
    });

    it('lists active users system-wide, excluding the caller, with no org filter', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      await service.listImpersonatableUsers(caller);
      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { isActive: true, id: { not: 'director-1' } },
        }),
      );
    });
  });

  describe('exitImpersonation', () => {
    it('throws BadRequestException when the caller is not impersonating', async () => {
      const caller = {
        id: 'rep-1',
        name: 'Rep',
        email: 'rep@example.com',
        role: Role.SALES_REP,
        teamId: 'team-1',
        orgId: 'org-1',
      };
      await expect(service.exitImpersonation(caller)).rejects.toThrow(BadRequestException);
    });

    it('logs the end event against the original director', async () => {
      const caller = {
        id: 'rep-1',
        name: 'Rep',
        email: 'rep@example.com',
        role: Role.SALES_REP,
        teamId: 'team-1',
        orgId: 'org-1',
        impersonatedBy: 'director-1',
      };
      mockPrisma.auditLog.create.mockResolvedValue({});
      await service.exitImpersonation(caller);
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: { userId: 'director-1', action: 'IMPERSONATE_END', entity: 'User', entityId: 'rep-1' },
      });
    });
  });
});
