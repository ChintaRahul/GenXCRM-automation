import { test as base } from "@playwright/test";

// Specs pick the role they need by importing `test` from this file instead of
// `@playwright/test` directly; storageState is wired per-project in playwright.config.ts
// (each project's `use.storageState` points at the .auth/<role>.json produced by
// auth.setup.ts), so this fixture only needs to exist for a single shared `test` export.
export const test = base;
export { expect } from "@playwright/test";
