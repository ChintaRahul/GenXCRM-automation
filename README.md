# GenXCRM â€” Playwright Automation

Test-automation repo for GenXCRM. It contains the full application code (backend, frontend) so the
suite can run against a local stack, and the Playwright suites in `e2e/`.

> **Ownership.** `backend/`, `frontend/`, `docs/` etc. are a mirror of the `stage` branch and are
> overwritten automatically on every push to `stage` — do not edit them here.
> **`e2e/` is yours**: it was seeded once from the existing suite and is never overwritten by the sync,
> so write and commit your Playwright tests there (directly on `main` or via PRs).

## Setup

Prerequisites: Node 18+, Docker Desktop.

```bash
docker compose up -d                       # Postgres + Redis

# app dependencies
(cd backend  && npm install)
(cd frontend && npm install)

# e2e env files (isolated test DB `genxcrm_test`, ports 3001 / 5174)
cp e2e/env-templates/backend.env.e2e.template  backend/.env.e2e.local
cp e2e/env-templates/frontend.env.e2e.template frontend/.env.e2e.local
cp backend/.env.example backend/.env.local     # then set JWT_SECRET etc.; third-party keys stay blank

# e2e dependencies + seed
cd e2e
npm install
npx playwright install chromium
npm run seed
```

## Run

```bash
cd e2e
npm test              # headless, desktop + mobile
npm run test:headed
npm run test:ui
npm run report
```

See `e2e/README.md` for layout, the Manufacturing suite (`docs/GenXCRM-Manufacturing-Manual-Test-Cases.xlsx`),
roles and test accounts.
