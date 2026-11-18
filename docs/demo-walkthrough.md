# GenXCRM — Demo Walkthrough

A guided script for demoing GenXCRM end-to-end using the seeded demo organization,
**GenX Learning Academy**. The data covers every stage of the lead lifecycle, every
lead source, communications + call recordings, payments, nurturing, reporting, and
billing — so every major screen has something real to show.

## Login

| | |
|---|---|
| URL | https://app.genxcrm.co.in |
| Email | `chinta.rahul2@gmail.com` |
| Password | `Demo@12345` |
| Role | Director (full visibility across the org) |

To see role-scoped views, also log in as:
- **Manager** — `priya.sharma@genxacademy.demo` or `arjun.mehta@genxacademy.demo` (same password) — sees only their own team.
- **Sales Rep** — `neha.verma@genxacademy.demo`, `karan.singh@genxacademy.demo`, `ananya.iyer@genxacademy.demo`, or `vikram.rao@genxacademy.demo` — sees only their own assigned leads.

## Org Structure

```
GenX Learning Academy (Director: Rahul Chinta)
├── Team Alpha (Manager: Priya Sharma) — target 15/mo
│   ├── Neha Verma (Sales Rep)
│   └── Karan Singh (Sales Rep)
└── Team Beta (Manager: Arjun Mehta) — target 12/mo
    ├── Ananya Iyer (Sales Rep)
    └── Vikram Rao (Sales Rep)
```

60 leads, ~20% intentionally unassigned (to show the assignment queue).

## Suggested Flow (~15 minutes)

### 1. Dashboard (2 min)
Log in as Director. Point out:
- **KPI cards are clickable** — click "Total leads", "New today", "Enrolled (MTD)", "Revenue (MTD)" to deep-link into the filtered Leads view or Reports page.
- Pipeline funnel and lead-sources donut are populated across all 15 stages and 10 sources.
- Team leaderboard shows Team Alpha vs. Team Beta side by side.

### 2. Leads (4 min)
Navigate to **Leads**.
- Filter by stage (try `ENROLLMENT_PENDING` or `NEGOTIATION`) and by source (`GOOGLE_ADS`, `FACEBOOK`, `INSTAGRAM` are tied to real campaign/ad-set/ad records).
- Open a lead that has activity — look for one with a note, a call log, and an email in its timeline (leads with even-numbered creation order have this; any lead with a phone icon badge works).
- Show the **call recording** playback on a lead with a `CONNECTED` call outcome.
- Show hierarchy scoping: log in as a Sales Rep and note the Leads list only shows their assigned leads; log in as a Manager and note it's scoped to their team.

### 3. Nurturing (2 min)
Navigate to **Nurturing**. Three sequences are seeded:
- **Welcome New Leads** — the product's default, fires on lead creation.
- **Demo No-Show Follow-up** — 3-step sequence (email → WhatsApp → email).
- **Re-engagement – Cold Leads** — 2-step win-back sequence.

18 leads are enrolled across these with a mix of `active`, `completed`, and `removed`
statuses, so the enrollment list shows real variety. **All sequences are seeded
inactive on purpose** — this avoids firing real emails/WhatsApp messages against the
fake demo contacts. To show the automation actually running, activate one sequence
live during the demo (it'll only affect newly-enrolled leads from that point on).

### 4. Payments (2 min)
Navigate to **Payments**. Shows the full status spread:
- `PAID` (8 leads, some with a 2-installment plan)
- `PENDING`, `LINK_SENT`, `PARTIAL`, `OVERDUE` (across mid-pipeline leads)

Revenue is split between this month and last month so the Dashboard's Revenue (MTD)
delta indicator has something to show.

### 5. Reports (3 min)
Navigate to **Reports → Daily Sales & Lead Management Report**.
- **Set the date range to the last 60 days** (the default is "today," which will look
  empty since demo leads are backdated across the last ~6 weeks).
- Walk through Calling Report (per-rep call volume/connect rate), Enrollment Report,
  and Campaign Performance (CPL/CPE/conversion rate for all 3 campaigns).
- Export to Excel or PDF to show the download flow.

### 6. Integrations & Billing (2 min)
- **Integrations** — Facebook and Google Ads show as `Connected` (cosmetic demo state,
  not wired to real ad accounts).
- **Billing** — an active Growth plan subscription for 7 seats, with an email-credits
  add-on and billing history.

## Re-seeding

The demo data is fully idempotent — running the seed again wipes and rebuilds only
this org, with fresh relative dates (leads shift forward from "today" each time so the
Dashboard's date-based metrics never go stale).

```
node run-demo-seed.mjs
```

(Runs from the repo root; deploys nothing itself — run `node deploy-backend.mjs` first
if `backend/prisma/seed-demo.ts` has changed since the last deploy.)

## What's Deliberately Not Real

- Nurturing sequences are inactive (see above) — no real emails/WhatsApp sends.
- Integration "Connected" status is cosmetic — no live Facebook/Google Ads sync.
- Lead emails use `@example.com` and phone numbers are synthetic `+91` numbers — safe
  to click into and "contact" without reaching a real person.
