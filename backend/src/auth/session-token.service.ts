import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { mergeSecuritySettings } from '../common/constants/org-defaults';

export interface SessionTokenUser {
  id: string;
  email: string;
  role: string;
  orgId: string | null;
  impersonatedBy?: string;
}

// Mints the app's full-session JWT with an expiry driven by the caller's org
// Administration > Security > "Session timeout (minutes)" setting — replaces
// the flat JWT_EXPIRES_IN default (still used as a fallback pre-org-setup,
// e.g. right after OAuth signup before completeProfile()).
@Injectable()
export class SessionTokenService {
  constructor(
    private jwt: JwtService,
    private prisma: PrismaService,
  ) {}

  async mint(user: SessionTokenUser): Promise<string> {
    const payload: Record<string, unknown> = {
      sub: user.id,
      email: user.email,
      role: user.role,
      orgId: user.orgId,
    };
    if (user.impersonatedBy) payload.impersonatedBy = user.impersonatedBy;

    const expiresIn = await this.resolveExpiresIn(user.orgId);
    return this.jwt.sign(payload, { expiresIn });
  }

  private async resolveExpiresIn(orgId: string | null): Promise<string> {
    if (!orgId) return process.env.JWT_EXPIRES_IN || '7d';
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { securitySettings: true },
    });
    // Not every org has visited Security yet — mergeSecuritySettings falls
    // back to the same 60-minute default the UI shows.
    const { sessionTimeoutMinutes } = mergeSecuritySettings(org?.securitySettings);
    return `${sessionTimeoutMinutes}m`;
  }
}
