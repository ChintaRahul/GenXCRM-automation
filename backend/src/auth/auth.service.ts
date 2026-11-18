import {
  Injectable,
  Logger,
  UnauthorizedException,
  ConflictException,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { Role, VerificationTokenType, BillingInterval, Industry, WorkspaceType } from '@prisma/client';
import type { User } from '@prisma/client';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { CompleteProfileDto } from './dto/complete-profile.dto';
import { ConfirmRegistrationPaymentDto } from './dto/confirm-registration-payment.dto';
import type { OAuthProfile } from './strategies/google.strategy';
import { MailService } from '../modules/mail/mail.service';
import { NurturingService } from '../modules/nurturing/nurturing.service';
import { BillingService } from '../modules/billing/billing.service';
import { LeadsService } from '../modules/leads/leads.service';
import { ManufacturingDefaultsService } from '../modules/manufacturing-defaults/manufacturing-defaults.service';
import { MfaService } from './mfa.service';
import { SessionTokenService } from './session-token.service';
import { generateRawToken, hashToken } from '../common/crypto.utils';
import { RESET_TOKEN_TTL_MINUTES } from './auth.constants';
import { ErrorMessages } from '../common/constants/messages';
import { CURRENT_TERMS_VERSION } from '../common/constants/terms.constants';
import type { AuthUser } from '../common/types/auth-user.type';
import { IMPERSONATION_ALLOWED_EMAILS } from './impersonation-allowlist';
import {
  verifyEmailTemplate,
  welcomeTemplate,
  passwordResetTemplate,
  passwordChangedTemplate,
} from '../modules/mail/mail.templates';

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';
// Public base URL of this API (the domain registered with Facebook, e.g. the
// ngrok tunnel). Used to build the data-deletion status URL we hand back to Meta.
const API_URL = (process.env.API_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const VERIFY_TOKEN_TTL_HOURS = Number(process.env.VERIFY_TOKEN_TTL_HOURS ?? 24);

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private mail: MailService,
    private nurturing: NurturingService,
    private billing: BillingService,
    private leads: LeadsService,
    private manufacturingDefaults: ManufacturingDefaultsService,
    private mfa: MfaService,
    private sessionToken: SessionTokenService,
  ) {}

  // Emails are matched case- and whitespace-insensitively. Normalizing on every
  // read/write keeps the unique constraint effective (Postgres @unique is
  // case-sensitive) so "User@X.com" and "user@x.com" can't both register.
  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  // Industry becomes optional once the signup UI drops its dropdown in favor of the
  // workspace-type step (README §1) — Organization.industry stays required at the DB
  // layer for existing data/reporting, so derive a sensible value from workspaceType
  // when the caller doesn't send one explicitly. An explicit industry always wins.
  #resolveIndustry(workspaceType: WorkspaceType, industry?: Industry): Industry {
    if (industry) return industry;
    return workspaceType === WorkspaceType.MANUFACTURING ? Industry.MANUFACTURING : Industry.EDTECH;
  }

  async isEmailAvailable(email: string): Promise<boolean> {
    const normalized = this.normalizeEmail(email);
    const exists = await this.prisma.user.findUnique({ where: { email: normalized } });
    return !exists;
  }

  async register(dto: RegisterDto) {
    if (!dto.acceptedTerms) throw new BadRequestException(ErrorMessages.auth.termsNotAccepted);

    const email = this.normalizeEmail(dto.email);
    const exists = await this.prisma.user.findUnique({ where: { email } });
    if (exists) throw new ConflictException(ErrorMessages.auth.emailInUse);

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const slug = await this.uniqueSlug(dto.orgName);
    const workspaceType = dto.workspaceType ?? WorkspaceType.EDTECH;

    const { user, org } = await this.prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: { name: dto.name, email, phone: dto.phone, passwordHash, role: Role.DIRECTOR },
        select: { id: true, name: true, email: true, role: true, teamId: true },
      });

      const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

      const newOrg = await tx.organization.create({
        data: {
          name: dto.orgName,
          slug,
          workspaceType,
          industry: this.#resolveIndustry(workspaceType, dto.industry),
          size: dto.orgSize,
          website: dto.website,
          city: dto.city,
          state: dto.state,
          country: dto.country,
          timezone: dto.timezone,
          ownerId: newUser.id,
          trialEndsAt,
          termsAcceptedAt: new Date(),
          termsVersion: CURRENT_TERMS_VERSION,
        },
        select: {
          id: true,
          name: true,
          slug: true,
          workspaceType: true,
          industry: true,
          size: true,
          country: true,
          timezone: true,
          planStatus: true,
          trialEndsAt: true,
        },
      });

      await tx.user.update({ where: { id: newUser.id }, data: { orgId: newOrg.id } });

      return { user: newUser, org: newOrg };
    });

    // Provision the org's default welcome sequence so new leads are emailed automatically.
    // Fire-and-forget — no leads exist yet, and a failure must never roll back signup.
    void this.nurturing.createDefaultWelcomeSequence(org.id);

    // Seed Manufacturing Administration defaults (RolePermission/FieldPermission/ApprovalRule/
    // MasterValue/BusinessCalendar/Holiday/SlaPolicy). Fire-and-forget and self-swallowing —
    // a failed seed must never roll back signup; resolveOwnerScope safely defaults to OWN
    // when no RolePermission row exists yet.
    if (workspaceType === WorkspaceType.MANUFACTURING) {
      void this.manufacturingDefaults.seedForOrgSafely(org.id);
    }

    // Fire-and-forget: a failed email must never roll back signup (CLAUDE.md rule).
    // Only the verification email goes out now — the welcome email is sent once the
    // user actually verifies (see verifyEmail()).
    void this.issueAndSendVerification(user);

    // Drop this signup into GenXCRM's own leads list (source WEBSITE) so the sales
    // team can follow up — see LeadsService.captureWebsiteSignupLead. Fire-and-forget;
    // it already no-ops/logs internally rather than throwing.
    void this.leads.captureWebsiteSignupLead({
      name: dto.name,
      email,
      phone: dto.phone,
      orgName: dto.orgName,
      industry: org.industry,
      orgSize: dto.orgSize,
    });

    // Plan & payment step 3: a paid plan kicks off a Razorpay subscription for the
    // brand-new org, which the client completes via Razorpay checkout and then
    // confirms through confirmRegistrationPayment() below. Trial (or omitted) is
    // unchanged from here on. The user/org row above is already committed by this
    // point — a Razorpay failure here surfaces as billingSetupFailed rather than
    // unwinding the account, since the user can still verify email, log in, and
    // subscribe from Billing later.
    let subscriptionId: string | undefined;
    let razorpayKeyId: string | undefined;
    let billingSetupFailed = false;
    if (dto.selectedPlanId && dto.selectedPlanId !== 'trial') {
      try {
        const result = await this.billing.createSubscriptionForNewOrg(
          org.id,
          dto.selectedPlanId,
          dto.seats ?? 1,
          dto.billingInterval ?? BillingInterval.MONTHLY,
          dto.couponCode,
        );
        subscriptionId = result.subscriptionId;
        razorpayKeyId = result.razorpayKeyId;
      } catch (err) {
        this.logger.error(
          `Failed to start subscription for new org ${org.id}`,
          err instanceof Error ? err.message : String(err),
        );
        billingSetupFailed = true;
      }
    }

    // No auto-login for a trial signup: the user must verify their email before
    // they can sign in. A paid signup also gets no token here — it's minted only
    // once confirmRegistrationPayment() proves the Razorpay checkout succeeded.
    return { user, org, subscriptionId, razorpayKeyId, billingSetupFailed };
  }

  // Called after the client completes Razorpay checkout for a paid signup
  // (see register()). The Razorpay signature is the only trust boundary here —
  // there's no session yet, so it must cryptographically prove Razorpay itself
  // processed this payment for this exact org+subscription pair before we
  // activate billing and hand out a token.
  async confirmRegistrationPayment(dto: ConfirmRegistrationPaymentDto) {
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET ?? '')
      .update(`${dto.razorpayPaymentId}|${dto.razorpaySubscriptionId}`)
      .digest('hex');
    const expBuf = Buffer.from(expectedSignature, 'hex');
    const sigBuf = Buffer.from(dto.razorpaySignature, 'hex');
    const isValid = expBuf.length === sigBuf.length && crypto.timingSafeEqual(expBuf, sigBuf);
    if (!isValid) throw new UnauthorizedException(ErrorMessages.auth.invalidRegistrationPayment);

    await this.billing.confirmPaymentForOrg(dto.orgId, dto.razorpayPaymentId, dto.razorpaySubscriptionId);

    const org = await this.prisma.organization.findUnique({ where: { id: dto.orgId }, include: { owner: true } });
    if (!org) throw new NotFoundException(ErrorMessages.auth.registrationNotFound);

    // A completed payment is at least as strong proof of a real account as clicking
    // an email link — mark verified now so a later logout doesn't strand them behind
    // the login page's email-verification gate.
    if (!org.owner.emailVerified) {
      await this.prisma.user.update({
        where: { id: org.owner.id },
        data: { emailVerified: true, emailVerifiedAt: new Date() },
      });
    }

    const token = await this.sessionToken.mint({
      id: org.owner.id,
      email: org.owner.email,
      role: org.owner.role,
      orgId: org.id,
    });

    return {
      token,
      user: {
        id: org.owner.id,
        name: org.owner.name,
        email: org.owner.email,
        role: org.owner.role,
        teamId: org.owner.teamId,
        orgId: org.id,
        mustChangePassword: org.owner.mustChangePassword,
      },
    };
  }

  // Shared by login() and findOrCreateFromOAuth() — either method's `user` still
  // needs to clear the same MFA gate before a full session is minted: already
  // enrolled -> challenge token (no session yet); org enforces MFA but not yet
  // enrolled -> setup token (same, no session yet); otherwise -> a real session.
  private async resolveMfaOrSession(
    user: Pick<User, 'id' | 'email' | 'role' | 'orgId' | 'mfaSecret'>,
  ): Promise<
    | { mfaRequired: true; challengeToken: string }
    | { mustSetupMfa: true; setupToken: string; qrCodeDataUrl: string; secret: string }
    | { token: string }
  > {
    if (user.mfaSecret) {
      const challengeToken = this.jwt.sign({ sub: user.id, purpose: 'mfa_challenge' }, { expiresIn: '5m' });
      return { mfaRequired: true as const, challengeToken };
    }

    if (user.orgId) {
      const org = await this.prisma.organization.findUnique({
        where: { id: user.orgId },
        select: { securitySettings: true },
      });
      const security = org?.securitySettings as { mfaEnforced?: boolean } | null;
      if (security?.mfaEnforced) {
        const { setupToken, qrCodeDataUrl, secret } = await this.mfa.initSetupForUser(user.id, user.email);
        return { mustSetupMfa: true as const, setupToken, qrCodeDataUrl, secret };
      }
    }

    const token = await this.sessionToken.mint({
      id: user.id,
      email: user.email,
      role: user.role,
      orgId: user.orgId,
    });
    return { token };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: this.normalizeEmail(dto.email) },
      // org (workspaceType in particular) is needed immediately for the sidebar nav —
      // without it, user.org is undefined until the next getMe() refetch (e.g. a hard
      // reload), so a Manufacturing org's own sidebar silently falls back to EdTech
      // right after logging in. Same shape as me() below, minus the DRY cost of sharing
      // a select object across two different base queries.
      include: {
        org: {
          select: {
            id: true,
            name: true,
            website: true,
            workspaceType: true,
            planStatus: true,
            trialEndsAt: true,
            gstNumber: true,
          },
        },
      },
    });
    if (!user || !user.isActive) throw new UnauthorizedException(ErrorMessages.auth.invalidCredentials);

    if (!user.passwordHash) {
      throw new UnauthorizedException(ErrorMessages.auth.usesSso);
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException(ErrorMessages.auth.invalidCredentials);

    // Email-verification gate — enforced by default. Set AUTH_REQUIRE_VERIFIED_EMAIL=false
    // to disable (e.g. local dev). OAuth users and backfilled accounts are already verified.
    if (process.env.AUTH_REQUIRE_VERIFIED_EMAIL !== 'false' && !user.emailVerified) {
      throw new UnauthorizedException(ErrorMessages.auth.emailNotVerified);
    }

    const gate = await this.resolveMfaOrSession(user);
    if ('mfaRequired' in gate || 'mustSetupMfa' in gate) return gate;

    await this.prisma.auditLog.create({
      data: { userId: user.id, action: 'LOGIN', entity: 'User', entityId: user.id },
    });

    return {
      token: gate.token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        mfgRole: user.mfgRole,
        teamId: user.teamId,
        orgId: user.orgId,
        mustChangePassword: user.mustChangePassword,
        mfaConfigured: false,
        org: user.org && { ...user.org, isPlatformOrg: user.org.id === process.env.GENXCRM_INTERNAL_ORG_ID },
      },
    };
  }

  // Personal admin capability, gated by email allowlist rather than Role — see
  // impersonation-allowlist.ts. System-wide (not tenant-scoped): the allowlisted
  // caller can impersonate any user in any org, not just their own. Issues a
  // fresh JWT for the target user carrying `impersonatedBy` so the frontend can
  // show a banner and exit back later.
  async impersonate(targetUserId: string, caller: AuthUser) {
    if (!IMPERSONATION_ALLOWED_EMAILS.includes(caller.email)) {
      throw new ForbiddenException(ErrorMessages.auth.impersonationNotAllowed);
    }
    if (caller.impersonatedBy) {
      throw new ForbiddenException(ErrorMessages.auth.alreadyImpersonating);
    }
    if (targetUserId === caller.id) {
      throw new BadRequestException(ErrorMessages.auth.cannotImpersonateSelf);
    }

    const target = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!target) throw new NotFoundException(ErrorMessages.users.notFound);

    const token = await this.sessionToken.mint({
      id: target.id,
      email: target.email,
      role: target.role,
      orgId: target.orgId,
      impersonatedBy: caller.id,
    });

    await this.prisma.auditLog.create({
      data: { userId: caller.id, action: 'IMPERSONATE_START', entity: 'User', entityId: target.id },
    });

    return {
      token,
      user: {
        id: target.id,
        name: target.name,
        email: target.email,
        role: target.role,
        teamId: target.teamId,
        orgId: target.orgId,
      },
    };
  }

  async exitImpersonation(caller: AuthUser): Promise<void> {
    if (!caller.impersonatedBy) {
      throw new BadRequestException(ErrorMessages.auth.notImpersonating);
    }
    await this.prisma.auditLog.create({
      data: { userId: caller.impersonatedBy, action: 'IMPERSONATE_END', entity: 'User', entityId: caller.id },
    });
  }

  // System-wide user list for the impersonation picker — no orgId scoping,
  // gated by the same email allowlist as impersonate() itself.
  async listImpersonatableUsers(caller: AuthUser) {
    if (!IMPERSONATION_ALLOWED_EMAILS.includes(caller.email)) {
      throw new ForbiddenException(ErrorMessages.auth.impersonationNotAllowed);
    }
    return this.prisma.user.findMany({
      where: { isActive: true, id: { not: caller.id } },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        org: { select: { id: true, name: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  // Authenticated, forced first-login password change. Clears the
  // mustChangePassword flag and returns a fresh token + user so the client can
  // update its session and proceed into the app.
  async changePassword(userId: string, newPassword: string) {
    const passwordHash = await bcrypt.hash(newPassword, 10);
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash, mustChangePassword: false, passwordChangedAt: new Date() },
      select: { id: true, name: true, email: true, role: true, teamId: true, orgId: true },
    });

    const token = await this.sessionToken.mint({ id: user.id, email: user.email, role: user.role, orgId: user.orgId });

    void this.mail.send(user.email, 'Your password was changed', passwordChangedTemplate(user.name));

    return { token, user: { ...user, mustChangePassword: false } };
  }

  async findOrCreateFromOAuth(profile: OAuthProfile) {
    if (!profile.email) throw new UnauthorizedException(ErrorMessages.auth.noProviderEmail);

    const existing = await this.prisma.oAuthAccount.findUnique({
      where: { provider_providerId: { provider: profile.provider, providerId: profile.providerId } },
      include: { user: true },
    });

    let user: User | null = existing?.user ?? null;

    if (!user) {
      const email = this.normalizeEmail(profile.email);
      user = await this.prisma.user.findUnique({ where: { email } });

      if (!user) {
        user = await this.prisma.user.create({
          data: {
            name: profile.name,
            email,
            passwordHash: null,
            role: Role.DIRECTOR,
            // The OAuth provider already verified this email.
            emailVerified: true,
            emailVerifiedAt: new Date(),
          },
        });
      }

      await this.prisma.oAuthAccount.create({
        data: { provider: profile.provider, providerId: profile.providerId, userId: user.id },
      });
    }

    const gate = await this.resolveMfaOrSession(user);
    if ('mfaRequired' in gate || 'mustSetupMfa' in gate) return gate;

    // Only a *returning* SSO login (an OAuthAccount that already existed) gets
    // audit-logged — first-time account creation/linking is signup, not login.
    if (existing) {
      await this.prisma.auditLog.create({
        data: { userId: user.id, action: 'LOGIN', entity: 'User', entityId: user.id },
      });
    }

    return { token: gate.token, needsOrgSetup: !user.orgId };
  }

  // ── Facebook data deletion callback ───────────────────────────────────────
  // Meta POSTs a signed_request here when a user removes the app or asks for
  // their data to be deleted. We verify it, erase the PII we obtained via SSO,
  // and return the { url, confirmation_code } JSON Meta expects.
  async deleteFacebookData(signedRequest: string): Promise<{ url: string; confirmation_code: string }> {
    const fbUserId = this.parseSignedRequest(signedRequest);

    // All app accounts linked to this Facebook user. Idempotent: a repeat or
    // unknown request still returns a valid confirmation rather than failing.
    const links = await this.prisma.oAuthAccount.findMany({
      where: { provider: 'facebook', providerId: fbUserId },
      select: { userId: true },
    });

    if (links.length > 0) {
      await this.prisma.$transaction([
        // Sever the Facebook connection.
        this.prisma.oAuthAccount.deleteMany({ where: { provider: 'facebook', providerId: fbUserId } }),
        // Right-to-erasure (CLAUDE.md): scrub PII. email/name are non-nullable,
        // so we overwrite with a unique tombstone instead of null, and disable login.
        ...links.map((l) =>
          this.prisma.user.update({
            where: { id: l.userId },
            data: {
              name: 'Deleted user',
              email: `deleted+${l.userId}@deleted.genxcrm.invalid`,
              phone: null,
              passwordHash: null,
              isActive: false,
            },
          }),
        ),
      ]);
    }

    const confirmationCode = crypto.randomBytes(12).toString('hex');
    this.logger.log(
      `Facebook data deletion for fb user ${fbUserId}: erased ${links.length} account(s), code=${confirmationCode}`,
    );
    return {
      url: `${API_URL}/api/v1/auth/facebook/data-deletion/status?code=${confirmationCode}`,
      confirmation_code: confirmationCode,
    };
  }

  // Verifies Facebook's signed_request (HMAC-SHA256 over the base64url payload,
  // keyed by the app secret) and returns the Facebook user_id it carries.
  private parseSignedRequest(signedRequest: string): string {
    const secret = process.env.FACEBOOK_SSO_APP_SECRET ?? process.env.FACEBOOK_APP_SECRET;
    if (!secret) throw new BadRequestException(ErrorMessages.auth.facebookNotConfigured);

    const [encodedSig, payload] = (signedRequest ?? '').split('.');
    if (!encodedSig || !payload) throw new BadRequestException(ErrorMessages.auth.facebookSignatureInvalid);

    const expected = crypto.createHmac('sha256', secret).update(payload).digest();
    const provided = Buffer.from(encodedSig, 'base64url');
    if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
      throw new BadRequestException(ErrorMessages.auth.facebookSignatureInvalid);
    }

    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { user_id?: string };
    if (!data.user_id) throw new BadRequestException(ErrorMessages.auth.facebookSignatureInvalid);
    return data.user_id;
  }

  async completeProfile(userId: string, dto: CompleteProfileDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException(ErrorMessages.auth.userNotFound);
    if (user.orgId) throw new ConflictException(ErrorMessages.auth.orgAlreadyConfigured);
    if (!dto.acceptedTerms) throw new BadRequestException(ErrorMessages.auth.termsNotAccepted);

    const slug = await this.uniqueSlug(dto.orgName);
    const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    const workspaceType = dto.workspaceType ?? WorkspaceType.EDTECH;

    const org = await this.prisma.$transaction(async (tx) => {
      const newOrg = await tx.organization.create({
        data: {
          name: dto.orgName,
          slug,
          workspaceType,
          industry: this.#resolveIndustry(workspaceType, dto.industry),
          size: dto.orgSize,
          website: dto.website,
          city: dto.city,
          state: dto.state,
          country: dto.country,
          timezone: dto.timezone,
          ownerId: userId,
          trialEndsAt,
          termsAcceptedAt: new Date(),
          termsVersion: CURRENT_TERMS_VERSION,
        },
        select: { id: true, name: true, workspaceType: true, planStatus: true, trialEndsAt: true },
      });

      await tx.user.update({ where: { id: userId }, data: { orgId: newOrg.id } });

      return newOrg;
    });

    // Provision the org's default welcome sequence so new leads are emailed automatically.
    void this.nurturing.createDefaultWelcomeSequence(org.id);

    if (workspaceType === WorkspaceType.MANUFACTURING) {
      void this.manufacturingDefaults.seedForOrgSafely(org.id);
    }

    // Return a fresh token so the client's JWT now carries the new orgId.
    const token = await this.sessionToken.mint({ id: user.id, email: user.email, role: user.role, orgId: org.id });
    return { token, org };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        mfgRole: true,
        teamId: true,
        team: { select: { id: true, name: true } },
        mustChangePassword: true,
        mfaEnabledAt: true,
        orgId: true,
        org: {
          select: {
            id: true,
            name: true,
            website: true,
            workspaceType: true,
            planStatus: true,
            trialEndsAt: true,
            gstNumber: true,
          },
        },
      },
    });
    if (!user) return user;
    const { mfaEnabledAt, org, ...rest } = user;
    // Never expose the secret or the raw timestamp — just whether it's set.
    // Named `mfaConfigured` (not `mfaEnabled`) to avoid colliding with the
    // separate org-level `securitySettings.mfaEnabled` policy flag.
    // `isPlatformOrg` marks GenXCRM's own org, whose leads are prospects for the CRM itself —
    // the frontend uses it to default template `plan`/`amount` from the plan catalog.
    return {
      ...rest,
      org: org && { ...org, isPlatformOrg: org.id === process.env.GENXCRM_INTERNAL_ORG_ID },
      mfaConfigured: !!mfaEnabledAt,
    };
  }

  // ─── Email verification & password reset ──────────────────────────────────

  // Issues a fresh VERIFY_EMAIL token and emails the link. Fire-and-forget from
  // register(); errors are logged, never thrown.
  private async issueAndSendVerification(user: { id: string; name: string; email: string }): Promise<void> {
    try {
      const raw = generateRawToken();
      const expiresAt = new Date(Date.now() + VERIFY_TOKEN_TTL_HOURS * 60 * 60 * 1000);
      await this.prisma.verificationToken.create({
        data: { userId: user.id, type: VerificationTokenType.VERIFY_EMAIL, tokenHash: hashToken(raw), expiresAt },
      });
      const url = `${FRONTEND_URL}/verify-email?token=${raw}`;
      const sent = await this.mail.send(user.email, 'Verify your email', verifyEmailTemplate(user.name, url));
      // Deliberately logged at the AuthService layer (not just MailService's
      // generic send) so `pm2 logs` on prod shows a clear, greppable line
      // confirming whether a verification email specifically went out,
      // distinct from every other email type MailService handles. Checks
      // send()'s actual result rather than assuming success — send() never
      // throws (it degrades gracefully), so a bare "sent" log here would
      // otherwise fire even when SES silently failed.
      if (sent) {
        this.logger.log(`Verification email sent to ${user.email} (user ${user.id})`);
      } else {
        this.logger.warn(`Verification email NOT sent to ${user.email} (user ${user.id}) — see MailService error above`);
      }
    } catch (err) {
      this.logger.error(
        `Failed to issue verification for user ${user.id}`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  async verifyEmail(rawToken: string): Promise<{ verified: true }> {
    const token = await this.prisma.verificationToken.findUnique({ where: { tokenHash: hashToken(rawToken) } });

    if (!token || token.type !== VerificationTokenType.VERIFY_EMAIL) {
      throw new BadRequestException(ErrorMessages.auth.invalidOrExpiredToken);
    }
    // Already consumed but the user is verified — treat as success (idempotent).
    if (token.usedAt) {
      const user = await this.prisma.user.findUnique({ where: { id: token.userId } });
      if (user?.emailVerified) return { verified: true };
      throw new BadRequestException(ErrorMessages.auth.invalidOrExpiredToken);
    }
    if (token.expiresAt < new Date()) throw new BadRequestException(ErrorMessages.auth.invalidOrExpiredToken);

    const [user] = await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: token.userId },
        data: { emailVerified: true, emailVerifiedAt: new Date() },
        select: { name: true, email: true, org: { select: { name: true } } },
      }),
      this.prisma.verificationToken.update({ where: { id: token.id }, data: { usedAt: new Date() } }),
    ]);

    // Now that the email is confirmed, send the welcome email (fire-and-forget).
    void this.mail.send(user.email, 'Welcome to GenXCRM', welcomeTemplate(user.name, user.org?.name ?? 'your organization'));

    return { verified: true };
  }

  // Always resolves — the caller returns a generic 200 to avoid user enumeration.
  async resendVerification(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email: this.normalizeEmail(email) } });
    if (user && !user.emailVerified) {
      await this.issueAndSendVerification(user);
    }
  }

  // Always resolves — generic 200, no enumeration. SSO-only accounts are skipped.
  async forgotPassword(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email: this.normalizeEmail(email) } });
    if (!user) return;

    try {
      // Invalidate any prior reset tokens, then issue a fresh one.
      await this.prisma.verificationToken.deleteMany({
        where: { userId: user.id, type: VerificationTokenType.PASSWORD_RESET },
      });
      const raw = generateRawToken();
      const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000);
      await this.prisma.verificationToken.create({
        data: { userId: user.id, type: VerificationTokenType.PASSWORD_RESET, tokenHash: hashToken(raw), expiresAt },
      });
      const url = `${FRONTEND_URL}/reset-password?token=${raw}`;
      await this.mail.send(user.email, 'Reset your password', passwordResetTemplate(user.name, url));
    } catch (err) {
      this.logger.error(
        `Failed to issue password reset for user ${user.id}`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    const token = await this.prisma.verificationToken.findUnique({ where: { tokenHash: hashToken(rawToken) } });

    if (
      !token ||
      token.type !== VerificationTokenType.PASSWORD_RESET ||
      token.usedAt ||
      token.expiresAt < new Date()
    ) {
      throw new BadRequestException(ErrorMessages.auth.invalidOrExpiredToken);
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);

    await this.prisma.$transaction([
      // Clicking the emailed reset link proves ownership of the inbox, the same
      // proof OAuth and admin-invited accounts already get — so a reset also
      // clears the verification gate that would otherwise block the next login.
      this.prisma.user.update({
        where: { id: token.userId },
        data: { passwordHash, emailVerified: true, emailVerifiedAt: new Date(), passwordChangedAt: new Date() },
      }),
      this.prisma.verificationToken.update({ where: { id: token.id }, data: { usedAt: new Date() } }),
      // Invalidate any other outstanding reset tokens for this user.
      this.prisma.verificationToken.deleteMany({
        where: { userId: token.userId, type: VerificationTokenType.PASSWORD_RESET, usedAt: null },
      }),
    ]);

    const user = await this.prisma.user.findUnique({ where: { id: token.userId } });
    if (user) void this.mail.send(user.email, 'Your password was changed', passwordChangedTemplate(user.name));
  }

  private async uniqueSlug(orgName: string): Promise<string> {
    const base = orgName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const existing = await this.prisma.organization.findUnique({ where: { slug: base } });
    if (!existing) return base;
    const suffix = Math.floor(1000 + Math.random() * 9000);
    return `${base}-${suffix}`;
  }
}
