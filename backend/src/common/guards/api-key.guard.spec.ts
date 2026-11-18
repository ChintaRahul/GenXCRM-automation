import { ExecutionContext } from '@nestjs/common';
import { Role } from '@prisma/client';
import { ApiKeyGuard } from './api-key.guard';
import { PrismaService } from '../../prisma/prisma.service';

const mockPrisma = {
  organization: { findUnique: jest.fn() },
};

function contextWith(headers: Record<string, string | undefined>): ExecutionContext {
  const req = { headers, user: undefined } as unknown as { headers: Record<string, string | undefined>; user?: unknown };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('ApiKeyGuard', () => {
  let guard: ApiKeyGuard;

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new ApiKeyGuard(mockPrisma as unknown as PrismaService);
  });

  it('resolves the org and attaches an AuthUser for a valid x-api-key header', async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({
      id: 'org-1',
      ownerId: 'owner-1',
      workspaceType: 'EDTECH',
      owner: { name: 'Owner', email: 'owner@co.com' },
    });
    const ctx = contextWith({ 'x-api-key': 'gxc_live_abc' });
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
    expect(mockPrisma.organization.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { apiKey: 'gxc_live_abc' },
        select: expect.objectContaining({ workspaceType: true }),
      }),
    );
    const req = (ctx.switchToHttp().getRequest as () => { user?: unknown })();
    expect(req.user).toEqual({
      id: 'owner-1',
      name: 'Owner',
      email: 'owner@co.com',
      role: Role.DIRECTOR,
      teamId: null,
      orgId: 'org-1',
      workspaceType: 'EDTECH',
    });
  });

  it('resolves a valid Bearer gxc_live_ token the same way', async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({
      id: 'org-1',
      ownerId: 'owner-1',
      workspaceType: 'EDTECH',
      owner: { name: 'Owner', email: 'owner@co.com' },
    });
    const ctx = contextWith({ authorization: 'Bearer gxc_live_abc' });
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  it('rejects when no key is present', async () => {
    const ctx = contextWith({});
    expect(await guard.canActivate(ctx)).toBe(false);
    expect(mockPrisma.organization.findUnique).not.toHaveBeenCalled();
  });

  it('rejects an unknown key', async () => {
    mockPrisma.organization.findUnique.mockResolvedValue(null);
    const ctx = contextWith({ 'x-api-key': 'gxc_live_unknown' });
    expect(await guard.canActivate(ctx)).toBe(false);
  });

  it('ignores a normal user JWT bearer token (does not treat it as an API key)', async () => {
    const ctx = contextWith({ authorization: 'Bearer some.jwt.token' });
    expect(await guard.canActivate(ctx)).toBe(false);
    expect(mockPrisma.organization.findUnique).not.toHaveBeenCalled();
  });
});
