// e2e/fixtures/mfgUsers.ts — must match backend/prisma/seed-e2e-mfg.ts
export const MFG_PASSWORD = "E2ePass@12345";

export const MFG_ROLE_KEYS = [
  "superAdmin", "director", "salesHead", "salesManager", "salesExec1", "salesExec2",
  "appEngineer", "commercial", "operations", "accounts", "serviceManager", "serviceEngineer", "orgBAdmin",
] as const;
export type MfgRoleKey = (typeof MFG_ROLE_KEYS)[number];

export const MFG_USERS = Object.fromEntries(
  MFG_ROLE_KEYS.map((k) => [k, { email: `mfg.${k.toLowerCase()}@genxcrm-e2e.example`, name: k }]),
) as Record<MfgRoleKey, { email: string; name: string }>;

export const authFile = (role: MfgRoleKey): string => `.auth/mfg-${role}.json`;
