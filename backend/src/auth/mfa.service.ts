import { Injectable, UnauthorizedException, ConflictException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { authenticator } from 'otplib';
import * as crypto from 'crypto';
import * as QRCode from 'qrcode';
import { VerificationTokenType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../common/types/auth-user.type';
import { ErrorMessages } from '../common/constants/messages';
import { generateRawToken, hashToken } from '../common/crypto.utils';
import { MfaVerifyDto } from './dto/mfa-verify.dto';
import { MfaChallengeVerifyDto } from './dto/mfa-challenge-verify.dto';
import { MfaDisableDto } from './dto/mfa-disable.dto';
import { SessionTokenService } from './session-token.service';
import { MailService } from '../modules/mail/mail.service';
import { mfaResetRequestTemplate, mfaResetConfirmedTemplate } from '../modules/mail/mail.templates';
import { RESET_TOKEN_TTL_MINUTES } from './auth.constants';

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';

const MFA_SETUP_TTL = '10m';
const RECOVERY_CODE_COUNT = 10;
// Excludes 0/O/1/I so a handwritten or half-legible code isn't ambiguous.
const RECOVERY_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

interface SetupTokenPayload {
  sub: string;
  purpose: 'mfa_setup';
  secret: string;
}

interface ChallengeTokenPayload {
  sub: string;
  purpose: 'mfa_challenge';
}

@Injectable()
export class MfaService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private sessionToken: SessionTokenService,
    private mail: MailService,
  ) {}

  // Step 1 of self-service enrollment: generate a TOTP secret + QR code. The
  // secret is never persisted here — it only rides inside the signed setupToken
  // until verifySetup() proves the user actually scanned it, avoiding a
  // half-enrolled DB state.
  async initSetup(caller: AuthUser): Promise<{ setupToken: string; qrCodeDataUrl: string; secret: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: caller.id } });
    if (!user) throw new UnauthorizedException();
    if (user.mfaEnabledAt) throw new ConflictException(ErrorMessages.auth.mfaAlreadyEnabled);

    return this.issueSetup(user.id, user.email);
  }

  // Same as initSetup, but for the forced-enrollment path at login (no session
  // yet) — keyed directly off a userId already resolved by AuthService.login().
  async initSetupForUser(userId: string, email: string): Promise<{ setupToken: string; qrCodeDataUrl: string; secret: string }> {
    return this.issueSetup(userId, email);
  }

  // Regenerates the QR code + secret for an already-issued setupToken, without
  // minting a new one. Needed because the OAuth callback flow can only pass the
  // setupToken itself through a redirect URL (see auth.controller.ts's
  // oauthRedirectTarget) — MfaSetupPage calls this to fetch the rest once it
  // lands with just that token and no route-state payload.
  async getSetupInfo(setupToken: string): Promise<{ qrCodeDataUrl: string; secret: string }> {
    const payload = this.verifyPurposeToken<SetupTokenPayload>(setupToken, 'mfa_setup');
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) throw new UnauthorizedException();

    const otpauthUrl = authenticator.keyuri(user.email, 'GenXCRM', payload.secret);
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);
    return { qrCodeDataUrl, secret: payload.secret };
  }

  private async issueSetup(userId: string, email: string) {
    const secret = authenticator.generateSecret();
    const otpauthUrl = authenticator.keyuri(email, 'GenXCRM', secret);
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);
    const setupToken = this.jwt.sign(
      { sub: userId, purpose: 'mfa_setup', secret } satisfies SetupTokenPayload,
      { expiresIn: MFA_SETUP_TTL },
    );
    return { setupToken, qrCodeDataUrl, secret };
  }

  // Step 2 of enrollment: verifies the code against the secret embedded in the
  // setupToken, then persists it. Always mints a fresh session token in the
  // response — ignored by a self-service caller who already has one, used by a
  // forced-enrollment caller who doesn't.
  async verifySetup(dto: MfaVerifyDto): Promise<{ enabled: true; token: string; user: SessionUser; recoveryCodes: string[] }> {
    const payload = this.verifyPurposeToken<SetupTokenPayload>(dto.setupToken, 'mfa_setup');

    const valid = authenticator.verify({ token: dto.code, secret: payload.secret });
    if (!valid) throw new UnauthorizedException(ErrorMessages.auth.mfaInvalidCode);

    const user = await this.prisma.user.update({
      where: { id: payload.sub },
      data: { mfaSecret: payload.secret, mfaEnabledAt: new Date() },
    });
    const recoveryCodes = await this.issueRecoveryCodes(user.id);

    const token = await this.sessionToken.mint(user);
    return { enabled: true, token, user: toSessionUser(user), recoveryCodes };
  }

  // Login-time challenge: accepts either a TOTP code or a recovery code
  // (dash-formatted, e.g. ABCD-2345 — a TOTP code never contains a dash).
  // Either path mints a full session token exactly like a normal login.
  async verifyChallenge(dto: MfaChallengeVerifyDto): Promise<{ token: string; user: SessionUser }> {
    const payload = this.verifyPurposeToken<ChallengeTokenPayload>(dto.challengeToken, 'mfa_challenge');

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.mfaSecret) throw new UnauthorizedException();

    if (dto.code.includes('-')) {
      await this.consumeRecoveryCode(payload.sub, dto.code);
    } else {
      const valid = authenticator.verify({ token: dto.code, secret: user.mfaSecret });
      if (!valid) throw new UnauthorizedException(ErrorMessages.auth.mfaInvalidCode);
    }

    const token = await this.sessionToken.mint(user);
    return { token, user: toSessionUser(user) };
  }

  // Requires the current code before disabling — same "prove you still have it"
  // shape as changePassword requiring the current password elsewhere.
  async disable(caller: AuthUser, dto: MfaDisableDto): Promise<{ disabled: true }> {
    const user = await this.prisma.user.findUnique({ where: { id: caller.id } });
    if (!user?.mfaSecret) throw new BadRequestException(ErrorMessages.auth.mfaNotEnabled);

    const valid = authenticator.verify({ token: dto.code, secret: user.mfaSecret });
    if (!valid) throw new UnauthorizedException(ErrorMessages.auth.mfaInvalidCode);

    await this.prisma.mfaRecoveryCode.deleteMany({ where: { userId: caller.id } });
    await this.prisma.user.update({
      where: { id: caller.id },
      data: { mfaSecret: null, mfaEnabledAt: null },
    });
    return { disabled: true };
  }

  // Self-service "lost your authenticator" reset. Always resolves — no
  // enumeration, and silently no-ops for a user who never enabled MFA.
  async requestReset(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    if (!user || !user.mfaSecret) return;

    await this.prisma.verificationToken.deleteMany({
      where: { userId: user.id, type: VerificationTokenType.MFA_RESET },
    });
    const raw = generateRawToken();
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000);
    await this.prisma.verificationToken.create({
      data: { userId: user.id, type: VerificationTokenType.MFA_RESET, tokenHash: hashToken(raw), expiresAt },
    });
    const url = `${FRONTEND_URL}/mfa-reset?token=${raw}`;
    await this.mail.send(user.email, 'Reset your two-factor authentication', mfaResetRequestTemplate(user.name, url));
  }

  // Confirms the emailed link: turns MFA off entirely (secret + recovery
  // codes cleared) so the next login goes through the normal password flow —
  // re-enrollment (if the org enforces it) happens exactly like a
  // never-enrolled user's first login. Does not mint a session token.
  async confirmReset(rawToken: string): Promise<void> {
    const token = await this.prisma.verificationToken.findUnique({ where: { tokenHash: hashToken(rawToken) } });
    if (
      !token ||
      token.type !== VerificationTokenType.MFA_RESET ||
      token.usedAt ||
      token.expiresAt < new Date()
    ) {
      throw new BadRequestException(ErrorMessages.auth.invalidOrExpiredToken);
    }

    await this.clearMfaAndNotify(token.userId);
    await this.prisma.verificationToken.update({ where: { id: token.id }, data: { usedAt: new Date() } });
  }

  // Director-assisted reset for a teammate who lost both their authenticator
  // and their recovery codes — same end state as confirmReset, just triggered
  // by an admin instead of an emailed link. Caller's org/role authorization
  // happens in UsersService before this is called.
  async adminReset(userId: string): Promise<void> {
    await this.clearMfaAndNotify(userId);
  }

  private async clearMfaAndNotify(userId: string): Promise<void> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { mfaSecret: null, mfaEnabledAt: null },
    });
    await this.prisma.mfaRecoveryCode.deleteMany({ where: { userId } });
    void this.mail.send(user.email, 'Your two-factor authentication was reset', mfaResetConfirmedTemplate(user.name));
  }

  // 10 single-use codes, format XXXX-XXXX. Raw codes are returned to the
  // caller exactly once; only their SHA-256 hashes are persisted.
  private generateRecoveryCodes(): { raw: string[]; hashes: string[] } {
    const raw: string[] = [];
    const hashes: string[] = [];
    for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
      const chars = Array.from({ length: 8 }, () => {
        const idx = crypto.randomInt(RECOVERY_CODE_ALPHABET.length);
        return RECOVERY_CODE_ALPHABET[idx];
      });
      const code = `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
      raw.push(code);
      hashes.push(hashToken(code));
    }
    return { raw, hashes };
  }

  // Replaces any previous set (re-enrollment after a disable gets a fresh set)
  // and returns the raw codes for the caller to hand back exactly once.
  private async issueRecoveryCodes(userId: string): Promise<string[]> {
    const { raw, hashes } = this.generateRecoveryCodes();
    await this.prisma.mfaRecoveryCode.deleteMany({ where: { userId } });
    await this.prisma.mfaRecoveryCode.createMany({
      data: hashes.map((codeHash) => ({ userId, codeHash })),
    });
    return raw;
  }

  private async consumeRecoveryCode(userId: string, rawCode: string): Promise<void> {
    const result = await this.prisma.mfaRecoveryCode.updateMany({
      where: { userId, codeHash: hashToken(rawCode.toUpperCase()), usedAt: null },
      data: { usedAt: new Date() },
    });
    if (result.count === 0) throw new UnauthorizedException(ErrorMessages.auth.mfaInvalidCode);
  }

  private verifyPurposeToken<T extends { sub: string; purpose: string }>(
    token: string,
    purpose: T['purpose'],
  ): T {
    let payload: T;
    try {
      payload = this.jwt.verify<T>(token);
    } catch {
      throw new UnauthorizedException(ErrorMessages.auth.mfaInvalidOrExpiredToken);
    }
    if (payload.purpose !== purpose) throw new UnauthorizedException(ErrorMessages.auth.mfaInvalidOrExpiredToken);
    return payload;
  }
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: string;
  teamId: string | null;
  orgId: string | null;
  mustChangePassword: boolean;
  mfaConfigured: boolean;
}

function toSessionUser(user: {
  id: string;
  name: string;
  email: string;
  role: string;
  teamId: string | null;
  orgId: string | null;
  mustChangePassword: boolean;
  mfaSecret: string | null;
}): SessionUser {
  const { id, name, email, role, teamId, orgId, mustChangePassword, mfaSecret } = user;
  return { id, name, email, role, teamId, orgId, mustChangePassword, mfaConfigured: !!mfaSecret };
}
