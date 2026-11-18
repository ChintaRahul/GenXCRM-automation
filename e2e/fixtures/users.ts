// Must stay in sync with backend/prisma/seed-e2e.ts — these are the fixed E2E test
// accounts seeded into the dedicated `genxcrm_test` local database.

export type Role = "director" | "manager" | "salesRep";

export const E2E_PASSWORD = "E2ePass@12345";

export const E2E_USERS: Record<Role, { email: string; name: string }> = {
  director: { email: "e2e.director@genxcrm-e2e.example", name: "E2E Director" },
  manager: { email: "e2e.manager@genxcrm-e2e.example", name: "E2E Manager" },
  salesRep: { email: "e2e.salesrep@genxcrm-e2e.example", name: "E2E Sales Rep" },
};
