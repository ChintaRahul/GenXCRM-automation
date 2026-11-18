import { Test } from '@nestjs/testing';
import { UnauthorizedException, ConflictException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { authenticator } from 'otplib';
import { MfaService } from './mfa.service';
import { PrismaService } from '../prisma/prisma.service';
import { SessionTokenService } from './session-token.service';
import { MailService } from '../modules/mail/mail.service';
import type { AuthUser } from '../common/types/auth-user.type';

// A tiny fake JwtService — real otplib codes are used (pure, deterministic given
// a secret), but the JWT layer is faked so tests can construct tampered/expired
// tokens without needing a real signing key or waiting on TTLs.
class FakeJwtService {
  sign(payload: object): string {
    return `signed:${JSON.stringify(payload)}`;
  }
  verify<T>(token: string): T {
    if (!token.startsWith('signed:')) throw new Error('invalid token');
    return JSON.parse(token.slice('signed:'.length)) as T;
  }
}

const mockPrisma = {
  user: { findUnique: jest.fn(), update: jest.fn() },
  mfaRecoveryCode: { deleteMany: jest.fn(), createMany: jest.fn(), findFirst: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  verificationToken: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), deleteMany: jest.fn() },
};

const mockSessionToken = { mint: jest.fn().mockResolvedValue('session-token') };

const mockMail = { send: jest.fn() };

describe('MfaService', () => {
  let service: MfaService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockSessionToken.mint.mockResolvedValue('session-token');
    mockPrisma.mfaRecoveryCode.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.mfaRecoveryCode.createMany.mockResolvedValue({ count: 10 });
    mockPrisma.mfaRecoveryCode.updateMany.mockResolvedValue({ count: 1 });
    mockMail.send.mockResolvedValue(true);
    const module = await Test.createTestingModule({
      providers: [
        MfaService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useClass: FakeJwtService },
        { provide: SessionTokenService, useValue: mockSessionToken },
        { provide: MailService, useValue: mockMail },
      ],
    }).compile();
    service = module.get(MfaService);
  });

  describe('initSetup', () => {
    it('returns a setup token and QR code for an unenrolled user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@b.com', mfaEnabledAt: null });
      const result = await service.initSetup({ id: 'u1' } as AuthUser);
      expect(result.setupToken).toContain('mfa_setup');
      expect(result.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
      expect(result.secret).toBeTruthy();
    });

    it('rejects when the user already has MFA enabled', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@b.com', mfaEnabledAt: new Date() });
      await expect(service.initSetup({ id: 'u1' } as AuthUser)).rejects.toThrow(ConflictException);
    });
  });

  describe('getSetupInfo', () => {
    it("regenerates the QR code and returns the token's embedded secret, without minting a new setupToken", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@b.com' });
      const secret = authenticator.generateSecret();
      const setupToken = `signed:${JSON.stringify({ sub: 'u1', purpose: 'mfa_setup', secret })}`;

      const result = await service.getSetupInfo(setupToken);

      expect(result.secret).toBe(secret);
      expect(result.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
    });

    it('rejects a token with the wrong purpose', async () => {
      const wrongPurposeToken = `signed:${JSON.stringify({ sub: 'u1', purpose: 'mfa_challenge' })}`;
      await expect(service.getSetupInfo(wrongPurposeToken)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects when the token names a user that no longer exists', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      const secret = authenticator.generateSecret();
      const setupToken = `signed:${JSON.stringify({ sub: 'gone', purpose: 'mfa_setup', secret })}`;
      await expect(service.getSetupInfo(setupToken)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('verifySetup', () => {
    it('persists the secret and mints a session token on a correct code', async () => {
      const secret = authenticator.generateSecret();
      const code = authenticator.generate(secret);
      mockPrisma.user.update.mockResolvedValue({
        id: 'u1', name: 'A', email: 'a@b.com', role: 'DIRECTOR', teamId: null, orgId: 'org-1',
        mustChangePassword: false, mfaSecret: secret,
      });

      const result = await service.verifySetup({
        setupToken: `signed:${JSON.stringify({ sub: 'u1', purpose: 'mfa_setup', secret })}`,
        code,
      });

      expect(result.enabled).toBe(true);
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'u1' },
          data: expect.objectContaining({ mfaSecret: secret }),
        }),
      );
      expect(result.token).toBeTruthy();
      expect(result.user.mfaConfigured).toBe(true);
    });

    it('replaces any existing recovery codes with 10 fresh, unique ones', async () => {
      const secret = authenticator.generateSecret();
      const code = authenticator.generate(secret);
      mockPrisma.user.update.mockResolvedValue({
        id: 'u1', name: 'A', email: 'a@b.com', role: 'DIRECTOR', teamId: null, orgId: 'org-1',
        mustChangePassword: false, mfaSecret: secret,
      });

      const result = await service.verifySetup({
        setupToken: `signed:${JSON.stringify({ sub: 'u1', purpose: 'mfa_setup', secret })}`,
        code,
      });

      expect(mockPrisma.mfaRecoveryCode.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
      expect(mockPrisma.mfaRecoveryCode.createMany).toHaveBeenCalledTimes(1);
      const createArg = mockPrisma.mfaRecoveryCode.createMany.mock.calls[0][0];
      expect(createArg.data).toHaveLength(10);
      expect(createArg.data.every((r: { userId: string }) => r.userId === 'u1')).toBe(true);

      expect(result.recoveryCodes).toHaveLength(10);
      expect(new Set(result.recoveryCodes).size).toBe(10);
      // format: XXXX-XXXX from the unambiguous alphabet
      for (const raw of result.recoveryCodes) {
        expect(raw).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/);
      }
    });

    it('rejects a wrong code', async () => {
      const secret = authenticator.generateSecret();
      await expect(
        service.verifySetup({
          setupToken: `signed:${JSON.stringify({ sub: 'u1', purpose: 'mfa_setup', secret })}`,
          code: '000000',
        }),
      ).rejects.toThrow(UnauthorizedException);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects a tampered/invalid token', async () => {
      await expect(service.verifySetup({ setupToken: 'not-a-real-token', code: '123456' })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a token with the wrong purpose', async () => {
      await expect(
        service.verifySetup({
          setupToken: `signed:${JSON.stringify({ sub: 'u1', purpose: 'mfa_challenge' })}`,
          code: '123456',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('verifyChallenge', () => {
    it('mints a session token on a correct code against the persisted secret', async () => {
      const secret = authenticator.generateSecret();
      const code = authenticator.generate(secret);
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u1', name: 'A', email: 'a@b.com', role: 'DIRECTOR', teamId: null, orgId: 'org-1',
        mustChangePassword: false, mfaSecret: secret,
      });

      const result = await service.verifyChallenge({
        challengeToken: `signed:${JSON.stringify({ sub: 'u1', purpose: 'mfa_challenge' })}`,
        code,
      });

      expect(result.token).toBeTruthy();
      expect(result.user.id).toBe('u1');
      expect(result.user.mfaConfigured).toBe(true);
    });

    it('rejects a wrong code', async () => {
      const secret = authenticator.generateSecret();
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', mfaSecret: secret });
      await expect(
        service.verifyChallenge({
          challengeToken: `signed:${JSON.stringify({ sub: 'u1', purpose: 'mfa_challenge' })}`,
          code: '000000',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a non-mfa_challenge purpose token', async () => {
      await expect(
        service.verifyChallenge({
          challengeToken: `signed:${JSON.stringify({ sub: 'u1', purpose: 'mfa_setup', secret: 'x' })}`,
          code: '123456',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('accepts a valid, unused recovery code and marks it used', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u1', name: 'A', email: 'a@b.com', role: 'DIRECTOR', teamId: null, orgId: 'org-1',
        mustChangePassword: false, mfaSecret: 'SECRET',
      });
      mockPrisma.mfaRecoveryCode.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.verifyChallenge({
        challengeToken: `signed:${JSON.stringify({ sub: 'u1', purpose: 'mfa_challenge' })}`,
        code: 'ABCD-2345',
      });

      expect(mockPrisma.mfaRecoveryCode.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', codeHash: expect.any(String), usedAt: null },
        data: { usedAt: expect.any(Date) },
      });
      expect(result.token).toBeTruthy();
      expect(result.user.mfaConfigured).toBe(true);
    });

    it('rejects an unknown or already-used recovery code', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', mfaSecret: 'SECRET' });
      mockPrisma.mfaRecoveryCode.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.verifyChallenge({
          challengeToken: `signed:${JSON.stringify({ sub: 'u1', purpose: 'mfa_challenge' })}`,
          code: 'ABCD-2345',
        }),
      ).rejects.toThrow(UnauthorizedException);
      expect(mockPrisma.mfaRecoveryCode.updateMany).toHaveBeenCalled();
    });
  });

  describe('disable', () => {
    it('clears the secret on a correct current code', async () => {
      const secret = authenticator.generateSecret();
      const code = authenticator.generate(secret);
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', mfaSecret: secret });

      await service.disable({ id: 'u1' } as AuthUser, { code });

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { mfaSecret: null, mfaEnabledAt: null },
      });
    });

    it('rejects a wrong current code', async () => {
      const secret = authenticator.generateSecret();
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', mfaSecret: secret });
      await expect(service.disable({ id: 'u1' } as AuthUser, { code: '000000' })).rejects.toThrow(UnauthorizedException);
    });

    it('rejects when MFA is not enabled', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', mfaSecret: null });
      await expect(service.disable({ id: 'u1' } as AuthUser, { code: '123456' })).rejects.toThrow(BadRequestException);
    });

    it('deletes recovery codes along with the secret', async () => {
      const secret = authenticator.generateSecret();
      const code = authenticator.generate(secret);
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', mfaSecret: secret });
      mockPrisma.user.update.mockResolvedValue({});

      await service.disable({ id: 'u1' } as AuthUser, { code });

      expect(mockPrisma.mfaRecoveryCode.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'u1' }, data: { mfaSecret: null, mfaEnabledAt: null } }),
      );
    });
  });

  describe('requestReset', () => {
    it('does nothing for an unknown email', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await service.requestReset('nobody@x.com');
      expect(mockMail.send).not.toHaveBeenCalled();
    });

    it('does nothing for a user without MFA enabled', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@b.com', name: 'A', mfaSecret: null });
      await service.requestReset('a@b.com');
      expect(mockMail.send).not.toHaveBeenCalled();
    });

    it('invalidates prior tokens and emails a reset link for an MFA-enabled user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@b.com', name: 'A', mfaSecret: 'SECRET' });
      await service.requestReset('a@b.com');

      expect(mockPrisma.verificationToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'u1', type: 'MFA_RESET' },
      });
      expect(mockPrisma.verificationToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'u1', type: 'MFA_RESET' }),
        }),
      );
      expect(mockMail.send).toHaveBeenCalledWith('a@b.com', expect.any(String), expect.any(String));
    });
  });

  describe('confirmReset', () => {
    it('rejects a missing/wrong-type/used/expired token', async () => {
      mockPrisma.verificationToken.findUnique.mockResolvedValue(null);
      await expect(service.confirmReset('bad-token')).rejects.toThrow(BadRequestException);

      mockPrisma.verificationToken.findUnique.mockResolvedValue({
        id: 't1', userId: 'u1', type: 'PASSWORD_RESET', usedAt: null, expiresAt: new Date(Date.now() + 60000),
      });
      await expect(service.confirmReset('wrong-type')).rejects.toThrow(BadRequestException);

      mockPrisma.verificationToken.findUnique.mockResolvedValue({
        id: 't1', userId: 'u1', type: 'MFA_RESET', usedAt: new Date(), expiresAt: new Date(Date.now() + 60000),
      });
      await expect(service.confirmReset('already-used')).rejects.toThrow(BadRequestException);

      mockPrisma.verificationToken.findUnique.mockResolvedValue({
        id: 't1', userId: 'u1', type: 'MFA_RESET', usedAt: null, expiresAt: new Date(Date.now() - 1000),
      });
      await expect(service.confirmReset('expired')).rejects.toThrow(BadRequestException);
    });

    it('clears MFA, deletes recovery codes, and marks the token used on success', async () => {
      mockPrisma.verificationToken.findUnique.mockResolvedValue({
        id: 't1', userId: 'u1', type: 'MFA_RESET', usedAt: null, expiresAt: new Date(Date.now() + 60000),
      });
      mockPrisma.user.update.mockResolvedValue({ id: 'u1', name: 'A', email: 'a@b.com' });

      await service.confirmReset('good-token');

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { mfaSecret: null, mfaEnabledAt: null },
      });
      expect(mockPrisma.mfaRecoveryCode.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
      expect(mockPrisma.verificationToken.update).toHaveBeenCalledWith({
        where: { id: 't1' },
        data: { usedAt: expect.any(Date) },
      });
      expect(mockMail.send).toHaveBeenCalledWith('a@b.com', expect.any(String), expect.any(String));
    });
  });

  describe('adminReset', () => {
    it('clears MFA and recovery codes for the given user', async () => {
      mockPrisma.user.update.mockResolvedValue({ id: 'u2', name: 'B', email: 'b@b.com' });

      await service.adminReset('u2');

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u2' },
        data: { mfaSecret: null, mfaEnabledAt: null },
      });
      expect(mockPrisma.mfaRecoveryCode.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u2' } });
      expect(mockMail.send).toHaveBeenCalledWith('b@b.com', expect.any(String), expect.any(String));
    });
  });
});
