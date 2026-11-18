import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { WorkspaceType } from '@prisma/client';
import { WorkspaceGuard } from './workspace.guard';
import type { AuthUser } from '../types/auth-user.type';

function contextWithMetadata(user: AuthUser | undefined, _required: WorkspaceType[] | undefined): ExecutionContext {
  const req = { user };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('WorkspaceGuard', () => {
  function makeGuard(required: WorkspaceType[] | undefined) {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(required) } as unknown as Reflector;
    return new WorkspaceGuard(reflector);
  }

  it('allows any caller when no @RequireWorkspace metadata is present', () => {
    const guard = makeGuard(undefined);
    const ctx = contextWithMetadata({ workspaceType: WorkspaceType.EDTECH } as AuthUser, undefined);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows a caller whose org workspaceType matches', () => {
    const guard = makeGuard([WorkspaceType.MANUFACTURING]);
    const ctx = contextWithMetadata({ workspaceType: WorkspaceType.MANUFACTURING } as AuthUser, [
      WorkspaceType.MANUFACTURING,
    ]);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('denies a caller whose org workspaceType does not match', () => {
    const guard = makeGuard([WorkspaceType.MANUFACTURING]);
    const ctx = contextWithMetadata({ workspaceType: WorkspaceType.EDTECH } as AuthUser, [WorkspaceType.MANUFACTURING]);
    expect(guard.canActivate(ctx)).toBe(false);
  });

  it('denies when there is no user on the request', () => {
    const guard = makeGuard([WorkspaceType.MANUFACTURING]);
    const ctx = contextWithMetadata(undefined, [WorkspaceType.MANUFACTURING]);
    expect(guard.canActivate(ctx)).toBe(false);
  });

  it('denies a caller with no org yet (workspaceType undefined)', () => {
    const guard = makeGuard([WorkspaceType.MANUFACTURING]);
    const ctx = contextWithMetadata({ workspaceType: undefined } as AuthUser, [WorkspaceType.MANUFACTURING]);
    expect(guard.canActivate(ctx)).toBe(false);
  });
});
