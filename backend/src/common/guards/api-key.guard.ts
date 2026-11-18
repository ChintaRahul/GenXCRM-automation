import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../types/auth-user.type';

const API_KEY_BEARER_PREFIX = 'gxc_live_';

// Authenticates a third-party request via the org's API key (Administration >
// API & Webhooks), as an alternative to a user JWT — accepted as either an
// `x-api-key` header or `Authorization: Bearer gxc_live_...`. Resolves the
// owning org and attaches a synthetic AuthUser (the org owner's identity,
// role DIRECTOR) so downstream services see a normal, org-scoped caller.
//
// No new Role enum value: this guard's attachment point (specific, opt-in
// routes) is the real access boundary, not the caller's role.
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const key = this.extractKey(req);
    if (!key) return false;

    const org = await this.prisma.organization.findUnique({
      where: { apiKey: key },
      select: {
        id: true,
        ownerId: true,
        workspaceType: true,
        owner: { select: { name: true, email: true } },
      },
    });
    if (!org) return false;

    const caller: AuthUser = {
      id: org.ownerId,
      name: org.owner.name,
      email: org.owner.email,
      role: Role.DIRECTOR,
      mfgRole: null,
      teamId: null,
      orgId: org.id,
      workspaceType: org.workspaceType,
    };
    (req as Request & { user: AuthUser }).user = caller;
    return true;
  }

  private extractKey(req: Request): string | undefined {
    const header = req.headers['x-api-key'];
    if (typeof header === 'string' && header) return header;

    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer ')) {
      const token = auth.slice('Bearer '.length);
      if (token.startsWith(API_KEY_BEARER_PREFIX)) return token;
    }
    return undefined;
  }
}
