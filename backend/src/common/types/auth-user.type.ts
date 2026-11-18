import type { MfgRole, User, WorkspaceType } from '@prisma/client';

export type AuthUser = Pick<User, 'id' | 'name' | 'email' | 'role' | 'teamId' | 'orgId'> & {
  // Denormalized from the caller's Organization by JwtStrategy.validate / ApiKeyGuard —
  // undefined/null until the user has completed org setup. Optional (not required) so the
  // dozens of existing spec files that build AuthUser literals without it keep compiling.
  workspaceType?: WorkspaceType | null;
  // Populated from User.mfgRole by JwtStrategy.validate for Manufacturing-workspace users.
  // Optional/nullable for the same reason as workspaceType above — most EdTech callers and
  // existing spec fixtures never set it, and record-access scoping treats a missing value
  // as "not yet assigned a manufacturing role" (falls back to the legacy Role-only behavior).
  mfgRole?: MfgRole | null;
  // Set when this session's JWT was issued via impersonation — the id of the
  // account that started it (see AuthService.impersonate/exitImpersonation).
  impersonatedBy?: string;
};
