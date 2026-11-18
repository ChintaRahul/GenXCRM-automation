import { ForbiddenException } from '@nestjs/common';
import type { AuthUser } from '../../common/types/auth-user.type';

export function requireOrgId(caller: AuthUser): string {
  if (!caller.orgId) throw new ForbiddenException('An organization is required for this action.');
  return caller.orgId;
}
