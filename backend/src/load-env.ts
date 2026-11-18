import { config } from 'dotenv';
import { existsSync } from 'node:fs';

// Prisma Client auto-loads `.env` the instant it is imported, and @nestjs/config's
// forRoot lets existing process.env win over its envFilePath (it spreads
// `{ ...fileConfig, ...process.env }`). So to make `.env.local` authoritative for local
// dev, we must load it FIRST — with `override` — before any other import runs.
//
// This module MUST be the very first import in main.ts. On production there is no
// `.env.local`, so this is a no-op there and `.env` behaves exactly as before.
if (existsSync('.env.local')) {
  config({ path: '.env.local', override: true });
}
// The `dev:e2e` script sets E2E=1 via dotenv-cli so this file's own .env.e2e.local
// values (PORT, DATABASE_URL, ...) win even over .env.local above — E2E itself
// survives the override since .env.local never defines it.
if (process.env.E2E && existsSync('.env.e2e.local')) {
  config({ path: '.env.e2e.local', override: true });
}
config(); // `.env` fallback — does not override keys already set from `.env.local`
