import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { WorkspaceType } from '@prisma/client';
import { Request } from 'express';
import { WORKSPACE_KEY } from '../decorators/require-workspace.decorator';
import type { AuthUser } from '../types/auth-user.type';

// Mirrors RolesGuard's shape exactly — gates a controller/handler to callers whose
// org workspaceType is in the decorated list. No metadata → always allowed. A caller
// with no org yet (workspaceType undefined) is denied on any decorated route, same as
// a caller with no role would be denied by RolesGuard.
@Injectable()
export class WorkspaceGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<WorkspaceType[]>(WORKSPACE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;
    const { user } = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    if (!user?.workspaceType) return false;
    return required.includes(user.workspaceType);
  }
}
