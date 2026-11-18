# GenXCRM E2E Tests

Playwright end-to-end tests for the real browser app — desktop and mobile viewport,
both running the same spec files against `frontend/src` via a Chromium browser.

## Isolation

This suite never touches your regular dev servers or dev data:

- **Database**: dedicated local Postgres `genxcrm_test` (same DB backend e2e-spec
  tests use), not the `genxcrm` DB `node dev.mjs` points at.
- **Redis**: dedicated logical DB (`REDIS_DB=1`) so BullMQ queues (round-robin
  assignment, etc.) never race with your regular dev backend's queue on DB 0.
- **Ports**: backend on `3001`, frontend on `5174` — separate from the usual
  `3000`/`5173`, so this suite can run alongside (or instead of) `node dev.mjs`.

All of this is configured via `backend/.env.e2e.local` and `frontend/.env.e2e.local`
(gitignored — created locally, not committed).

## First-time setup

```bash
# from repo root
docker compose up -d                 # postgres + redis must be running

cd e2e
npm install
npx playwright install chromium      # downloads the browser binary once

npm run seed                         # migrates + seeds the dedicated E2E org/users
```

`npm run seed` is idempotent — safe to re-run any time (upserts by fixed email).

## Running

```bash
npm test              # headless, both desktop + mobile projects
npm run test:headed   # see the browser
npm run test:ui       # Playwright's interactive UI mode
npm run report        # open the HTML report from the last run
```

Playwright's `webServer` config starts the E2E backend (`npm run dev:e2e` in
`backend/`) and frontend (`npm run dev:e2e` in `frontend/`) automatically if they
aren't already running, and reuses them if they are (handy for repeat runs while
iterating on a spec).

## Layout

```
e2e/
  playwright.config.ts   # projects (desktop / mobile), webServer, isolation config
  auth.setup.ts           # logs in once per role, saves storageState to .auth/
  fixtures/
    users.ts              # fixed E2E test accounts (must match backend/prisma/seed-e2e.ts)
  pages/                  # Page Object Model — one file per app page/section
  specs/                  # one *.spec.ts per user-facing flow
```

Specs pick a role via `test.use({ storageState: ".auth/<role>.json" })` (director /
manager / salesRep) rather than logging in through the UI each time.

## Adding a new flow

1. Add a Page Object under `pages/` if the flow touches a page that doesn't have one
   yet — keep selectors there, not in the spec.
2. Add a spec under `specs/`. It runs automatically against both `desktop` and
   `mobile` projects — write it once, don't duplicate per viewport. If a control
   genuinely differs by viewport (e.g. hamburger menu vs. sidebar), handle that inside
   the Page Object.
3. Round-robin assignment and any other async side effects are eventually consistent,
   not instant — see `LeadsPage.waitForLeadAssigned` for the pattern (poll the API
   in-page rather than repeatedly reloading the whole SPA).
4. Toasts can appear over any control at any time (org-wide WebSocket events, not just
   this test's own actions) — call `waitForToastsClear()` before a click that might be
   covered. Never remove toast DOM nodes directly; that crashes the app (fights React's
   own reconciliation of the same subtree).

---

# Manufacturing suite

Playwright suite for the **Manufacturing workspace** (project `mfg`, plus `mfg-mobile`). It automates the manual
test-case workbook `docs/GenXCRM-Manufacturing-Manual-Test-Cases.xlsx` (also `docs/GenXCRM-Manufacturing-Manual-Test-Cases-v2.pdf`):
**336 cases in 31 module codes** (ENV, LEAD, ACC, CON, OPP, ACT, RFQ, VIS, DEM, PRD, CST, QUO, APR, PO, SO, DSP, PAY, AST, AMC, SVC,
ENG, SLA, DSH, RPT, ADM, TEAM, GEN, SEC, NFR, E2E, P2). `e2e/mfg/cases.json` is the machine-readable copy (steps, expected result,
role, preconditions, verification notes, `automation` = auto / gap / skip). Results of the last full run and the defect register are in
`docs/MANUFACTURING-E2E-RUN-REPORT.md`.

## Prerequisites and one-time setup


- `S3_BUCKET=` empty (the guard also fails if it contains `production`), and `AWS_SHARED_CREDENTIALS_FILE` set to a nonexistent path (e.g. `C:/nonexistent/aws-credentials`) plus `AWS_PROFILE=e2e-none`, so the AWS SDK cannot fall back to your real `~/.aws` credentials.

The seed scripts (`npm run seed`) refuse to run unless `DATABASE_URL` is `localhost` + `genxcrm_test`, so this file must exist first.


```bash
docker compose up -d                       # postgres + redis (the suite uses DB genxcrm_test, redis DB 1)
cd e2e
npm install
npx playwright install chromium
npm run seed                               # migrate + seed: EdTech org, Manufacturing Org A + Org B, 13 mfg users (password E2ePass@12345)
```

## Running

```bash
npm test              # headless, both desktop + mobile projects
npm run test:headed   # see the browser
npm run test:ui       # Playwright's interactive UI mode
npm run report        # open the HTML report from the last run
```

Playwright's `webServer` config starts the E2E backend (`npm run dev:e2e` in
`backend/`) and frontend (`npm run dev:e2e` in `frontend/`) automatically if they
aren't already running, and reuses them if they are (handy for repeat runs while
iterating on a spec).

## Layout

```
e2e/
  playwright.config.ts   # projects (desktop / mobile), webServer, isolation config
  auth.setup.ts           # logs in once per role, saves storageState to .auth/
  fixtures/
    users.ts              # fixed E2E test accounts (must match backend/prisma/seed-e2e.ts)
  pages/                  # Page Object Model — one file per app page/section
  specs/                  # one *.spec.ts per user-facing flow
```

Specs pick a role via `test.use({ storageState: ".auth/<role>.json" })` (director /
manager / salesRep) rather than logging in through the UI each time.

## Adding a new flow

1. Add a Page Object under `pages/` if the flow touches a page that doesn't have one
   yet — keep selectors there, not in the spec.
2. Add a spec under `specs/`. It runs automatically against both `desktop` and
   `mobile` projects — write it once, don't duplicate per viewport. If a control
   genuinely differs by viewport (e.g. hamburger menu vs. sidebar), handle that inside
   the Page Object.
3. Round-robin assignment and any other async side effects are eventually consistent,
   not instant — see `LeadsPage.waitForLeadAssigned` for the pattern (poll the API
   in-page rather than repeatedly reloading the whole SPA).
4. Toasts can appear over any control at any time (org-wide WebSocket events, not just
   this test's own actions) — call `waitForToastsClear()` before a click that might be
   covered. Never remove toast DOM nodes directly; that crashes the app (fights React's
   own reconciliation of the same subtree).

---

# Manufacturing suite

Playwright suite for the **Manufacturing workspace** (project `mfg`, plus `mfg-mobile`). It automates the manual
test-case workbook `docs/GenXCRM-Manufacturing-Manual-Test-Cases.xlsx` (also `docs/GenXCRM-Manufacturing-Manual-Test-Cases-v2.pdf`):
**336 cases in 31 module codes** (ENV, LEAD, ACC, CON, OPP, ACT, RFQ, VIS, DEM, PRD, CST, QUO, APR, PO, SO, DSP, PAY, AST, AMC, SVC,
ENG, SLA, DSH, RPT, ADM, TEAM, GEN, SEC, NFR, E2E, P2). `e2e/mfg/cases.json` is the machine-readable copy (steps, expected result,
role, preconditions, verification notes, `automation` = auto / gap / skip). Results of the last full run and the defect register are in
`docs/MANUFACTURING-E2E-RUN-REPORT.md`.

## Prerequisites and one-time setup

```bash
docker compose up -d                       # postgres + redis (the suite uses DB genxcrm_test, redis DB 1)
cd e2e
npm install
npx playwright install chromium
npm run seed                               # migrate + seed: EdTech org, Manufacturing Org A + Org B, 13 mfg users (password E2ePass@12345)
```

`backend/.env.e2e.local` (gitignored, loaded FIRST by the E2E backend; first value wins) must contain:

- `DATABASE_URL` pointing at `genxcrm_test`, `REDIS_DB=1`, `PORT=3001`, `CORS_ORIGIN` / `FRONTEND_URL` for `:5174`.
- `SLA_TICK_MS=5000` and `SLA_DATE_SWEEP_MS=5000`. The SLA / date-driven specs (ACT-003, QUO-016, PAY-003, PAY-010, AMC-007/009, SLA, E2E-009 ...) depend on a 5 s sweep.
- **Blank provider credentials**: `WHATSAPP_API_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `AWS_ACCESS_KEY_ID`,
  `AWS_SECRET_ACCESS_KEY`, `SES_FROM_EMAIL`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` must be present and EMPTY
  (an empty value overrides the prod-shaped `backend/.env`). The `setup` project fails if any is non-blank (`e2e/mfg/envGuard.ts`).
  The suite never creates WhatsApp templates and never sends WhatsApp / SMS / email; do not add specs that do.

## Running

```bash
cd e2e
npx playwright test --project=setup                       # credential guard, 12 h logins, config heal, SLA-timer prune (do this first)
npx playwright test --project=mfg --no-deps               # the whole Manufacturing suite (336 tests, about 1 h)
npx playwright test --project=mfg --no-deps --grep "TC-LEAD"        # one module
npx playwright test --project=mfg --no-deps -g "TC-QUO-016"         # one case
npx playwright test --project=mfg-mobile --no-deps        # @responsive cases only (NFR-002, Pixel 5)
# JSON report: PLAYWRIGHT_JSON_OUTPUT_NAME=test-results/mfg-report.json npx playwright test --project=mfg --no-deps --reporter=list,json
```

Without `--no-deps`, Playwright runs `setup` first automatically. The suite is fully serial (one worker, one shared org).

### Starting the stack by hand

Playwright's `webServer` (dev servers, `reuseExistingServer`) often fails at cold start on a memory-constrained machine. Start the
stack yourself and Playwright reuses it:

```bash
docker start genxcrm-postgres-1 genxcrm-redis-1            # if not up
cd backend
NODE_OPTIONS=--max-old-space-size=4096 npm run build       # needs the bigger heap
npx dotenv -e .env.e2e.local -e .env.local -e .env -- node dist/main     # E2E backend on :3001 (leave running)
cd ../frontend && npm run dev:e2e                          # E2E frontend on :5174 (leave running)
```

Rebuild the backend `dist` whenever backend code changed (the suite tests what `dist` contains). If the backend dies (V8 OOM), restart it the same way
and re-run only the affected specs.

## Layout

```
e2e/
  specs/mfg/<module>.spec.ts   one file per module code (contacts.spec.ts = CON; "con" is a reserved Windows name); _coverage.spec.ts
  pages/mfg/                   ModuleList / ModuleDrawer / ModuleDetail / AdminPage / ConvertLeadDialog page objects
  fixtures/mfgUsers.ts         the 13 users, authFile(role), MfgRoleKey
  mfg/api.ts                   apiAs(role) REST client + build.* precondition builders (lead, account, opportunity, quotation, PO, ...)
  mfg/db.ts                    guarded DB helpers (see below)
  mfg/caseTest.ts              tc(id, body) wrapper; mfg/cases.json = case catalogue
  mfg/guards.ts                expectActionRejected, knownDefect
  mfg/envGuard.ts              readE2eEnv (backend/.env.e2e.local) + provider-credential guard
  mfg/{tag,routes,pdf,orgs}.ts unique data tags, routes, PDF text extraction, E2E org slugs
  auth.setup.ts                setup project: guard + logins + heal + prune
  .auth/                       gitignored: storage states, crash-safety backups, logs
```

### tc() and the `automation` field

Every case id appears as a string literal in exactly one `tc("TC-XXX-nnn", ...)` call (`_coverage.spec.ts` verifies that all 336 are registered once and no unknown ids exist).
`cases.json` `automation` decides what `tc()` does:

- `auto`: a normal test asserting the case's `expected` (or, for Partial cases, the behaviour in `verificationNote`).
- `gap`: a known missing feature. The body asserts the SPECIFIED behaviour; it **passes only when that assertion fails with a matcher error** (annotations `known-gap` and `known-gap-evidence`),
  and **fails** on any other error (setup / infra) or when the gap has been fixed (message: flip automation to `auto`).
- `skip:<reason>`: not browser-automatable (`external-delivery`, `wall-clock`, `manual-visual`, `infra`, `perf`, `cross-browser`); the body is empty and the test is reported as skipped.

`knownDefect(testInfo, "D-n", async () => { spec-correct assertion })` wraps ONLY the sub-assertion of an `auto` case that deviates because of a recorded defect: a matcher failure
becomes a `known-defect` annotation; an unexpected pass fails the test ("appears fixed - remove the wrapper"). **Exact-pin convention**: when a defect has a specific symptom (status 404, message X, "[object Object]") the test also asserts
that exact current symptom (with a message saying to remove it when fixed), so a change in behaviour is noticed. Defects are listed in the run report.

### Guarded DB helpers and the persisted-pre-state / heal pattern

Some cases must change shared org configuration (margin / approval rules, SLA policies, admin config, coverage status) that no API can edit (the config modules answer 403 for every role, D-7 / D-50 / D-124).
`e2e/mfg/db.ts` does it directly in Postgres and is hard-guarded to `localhost` + database `genxcrm_test` (the helpers refuse any other database). Pattern: (1) persist the exact pre-state to
`e2e/.auth/<name>-backup.json` BEFORE mutating, (2) restore in `finally`, (3) an idempotent `restore...IfNeeded()` runs in the `setup` project (and in `beforeAll` of the spec) and heals a leftover backup after a crash.
Backups: `margin-rules-backup.json`, `approval-rules-backup.json`, `sla-throwaway-backup.json`, `admin-config-backup.json`. None should exist after a clean run.

## Rules reviewers enforce

- **Server-guard errors are not shown in the UI** (`handleRunAction` only console-errors; axios shows a generic message). Assert a rejection through the API (`expectActionRejected`: exact 400 + message) AND assert the UI state is unchanged.
- **Absence assertions only after a positive loaded signal** (table / empty state / tab body visible, or the awaited API response). Prefer API reads filtered by your unique tag.
- **Unique data per test** (`build.*`, `uniqueTag/uniquePhone/uniqueEmail/uniqueGstin`); the DB is never reset. No global counts, no list positions of shared data (lists cap at 100 rows).
- Assert exact HTTP statuses; never weaken a spec-correct assertion; never pin current defective behaviour outside `knownDefect`.
- Time-of-day dependent assertions are not allowed (business-hours SLA is computed in UTC, D-17); use `skip:wall-clock`.
- ES2022, async/await, no `any`, arrow functions; `npx tsc --noEmit` in `e2e/` must be clean.

## SLA timers and sessions

SLA timers accumulate across runs (thousands of open timers make one engine tick take 30+ s). The setup project's "prune stale SLA timers" step deletes ALL timers of the E2E orgs (it runs before any spec, so they are from earlier runs; `E2E-SLA-` throwaway policies excepted).
Without it the backlog left by one run keeps an idle backend at ~85% CPU and the next run's PATCHes stall for 20 s+ (TC-OPP-004 failed in full runs 2 and 3 for this reason). The seed sets the E2E orgs' `securitySettings.sessionTimeoutMinutes=720`, so the stored logins live 12 h (the default 60 min expires mid-run and shows the login page).

## Regenerating / editing cases.json

`cases.json` was generated once from the test-case workbook builder and is now **committed and edited by hand**. To flip a gap after the feature is built: change that case's `automation` from `"gap"` to `"auto"`
and re-run the case (`-g "TC-XXX-nnn"`). Remove `knownDefect` wrappers (and mark the defect RESOLVED in the report) when a defect is fixed; the suite tells you ("appears fixed").

## Known limitations

- Single team in the seed: "Manager sees only own team" cannot be shown against a second team (SEC-008 asserts own / team / all among the seeded users plus the tenant boundary).
- The Playwright `webServer` cold start fails on a low-memory machine; start the stack by hand (above). The specs need `SLA_DATE_SWEEP_MS=5000` (a guard throws otherwise).
- Provider-backed flows (WhatsApp / SMS / email delivery, payment gateway, S3) are skipped by design (`external-delivery`).
- Orphan mixed-case orgs / users from earlier experiments may exist in `genxcrm_test`; never assert global user / org counts.
