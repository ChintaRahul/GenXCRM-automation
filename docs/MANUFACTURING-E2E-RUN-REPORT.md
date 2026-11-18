# Manufacturing workspace - Playwright E2E run report

- **Run date:** 2026-10-04 (IST). Branch `stage`.
- **Commits:** the three full runs were made on the suite as of commits `a274710`, `dcf531b` and `f5c60f4` respectively (run 1 / 2 / 3). Fixes made afterwards: `4547301`, `ec1abe9`, `18490c2` (HEAD of the suite when this document was written; the README/doc commit follows).
- **Backend under test:** `dist` rebuilt from HEAD with `NODE_OPTIONS=--max-old-space-size=4096 npm run build`. It includes the repo owner's uncommitted `backend/src/modules/trial/*` changes (unrelated to the Manufacturing workspace). The owner's fix `d1e2f72` (SLA date-sweep crash loop) is included.
- **Suite:** 336 manual cases (31 module codes) registered in `e2e/specs/mfg/*.spec.ts`, plus 5 helper tests (coverage check + 4 drift guards) = 341 Playwright tests in project `mfg`; `mfg-mobile` runs the single `@responsive` case (TC-NFR-002).

## Environment

Playwright's `webServer` cold start fails on this machine (memory), so the stack was started by hand and reused:

```
docker (already up): genxcrm-postgres-1, genxcrm-redis-1   # DB genxcrm_test, redis DB 1
cd backend && NODE_OPTIONS=--max-old-space-size=4096 npm run build
cd backend && npx dotenv -e .env.e2e.local -e .env.local -e .env -- node dist/main     # :3001, background
cd frontend && npm run dev:e2e                                                          # :5174, background
cd e2e && npx playwright test --project=setup                                           # guard, logins (12 h TTL), heal, SLA-timer prune
cd e2e && npx playwright test --project=mfg --no-deps --reporter=list,json
```

`backend/.env.e2e.local` has `SLA_TICK_MS=5000`, `SLA_DATE_SWEEP_MS=5000` and blank provider credentials (the guard passed in every setup run: 20 setup tests). No WhatsApp template was created and no message / email was sent. The backend process was never restarted (no V8 OOM).

## Result

Four full runs of `--project=mfg` (run 4 is the confirmation run on HEAD `d273c3f`, with the review-fix commits; it also ran the 21 setup tests, all passed):

| Run | Passed | Skipped | Failed | Duration | Failure |
|---|---|---|---|---|---|
| 1 (fresh DB state, 0 timers pruned) | 310 | 30 | 1 | 44.5 min | TC-ADM-007 (test bug, fixed `dcf531b`) |
| 2 | 310 | 30 | 1 | 45.2 min | TC-OPP-004 (flake, see triage) |
| 3 | 310 | 30 | 1 | 48.0 min | TC-OPP-004 (same cause) |
| 4 (confirmation, HEAD `d273c3f`) | 310 | 30 | 1 | 47.6 min | TC-DSH-001 (test fragility + new defect D-139, see below); TC-OPP-004 PASSED |

**Run 4 triage.** TC-OPP-004 passed (the SLA-timer prune fix holds). The only failure, TC-DSH-001, was a test fragility: My day's action queue shows only the 50 oldest open activities, and genxcrm_test (never reset) held 339 open ones for the Sales Executive, so the test's own "call today" row was out of view. Fix `clearActionQueue` (cancels the rep's open activities before the test; test-only, no assertion weakened) plus new defect D-139 (archived activities still appear in the queue and 404). The whole dsh spec file (29 tests) passes after the fix; no further full run was made, so strictly **no single full run has 0 failures**, but every failure seen across the four runs has been fixed and re-verified by a targeted rerun.

**Earlier statement (runs 1-3): there was no single full run with 0 failures.** The cap of three full runs was reached with TC-OPP-004 still failing in runs 2 and 3. It was then diagnosed and fixed (`4547301`, `ec1abe9`); the fix was verified by repeating the exact failing pair (TC-ADM-011 then TC-OPP-004) 5 times in a row (5/5 pass; it failed about 1 time in 2 before the fix) and by a targeted regression pass of the 20 spec files that use the changed helper (`statusText`): 228 passed, 8 skipped, 2 failed - TC-PAY-003 (SLA-22 timer not started within 30 s, window raised to 75 s in `18490c2`) and TC-SVC-005 (the laptop slept during that run: the test shows a 6.0 h duration; passes in 11.6 s in isolation). Both pass in isolation afterwards. `--project=mfg-mobile`: 1 passed. A final confirmation full run with the committed code is recommended (about 48 min); it was not made because of the three-run cap.

Counts below are from run 2 / run 3 (identical outcomes). The JSON of run 3 was overwritten by Playwright's output-dir cleanup before it was copied; the JSON of runs 1 and 2 is kept in `e2e/.auth/` (gitignored). "Expected-fail (gap)" = automation `gap` cases whose spec-correct assertion failed with a matcher error, i.e. confirmed missing features.

| Module | Cases | Passed | Expected-fail (gap) | Skipped | Failed |
|---|---|---|---|---|---|
| ENV | 15 | 13 | 0 | 2 | 0 |
| LEAD | 28 | 25 | 1 | 2 | 0 |
| ACC | 8 | 8 | 0 | 0 | 0 |
| CON | 5 | 5 | 0 | 0 | 0 |
| OPP | 16 | 14 | 0 | 1 | 1 |
| ACT | 9 | 9 | 0 | 0 | 0 |
| RFQ | 10 | 9 | 0 | 1 | 0 |
| VIS | 10 | 8 | 1 | 1 | 0 |
| DEM | 8 | 7 | 0 | 1 | 0 |
| PRD | 6 | 6 | 0 | 0 | 0 |
| CST | 13 | 13 | 0 | 0 | 0 |
| QUO | 20 | 19 | 1 | 0 | 0 |
| APR | 11 | 10 | 1 | 0 | 0 |
| PO | 14 | 13 | 0 | 1 | 0 |
| SO | 11 | 11 | 0 | 0 | 0 |
| DSP | 7 | 7 | 0 | 0 | 0 |
| PAY | 13 | 11 | 1 | 1 | 0 |
| AST | 7 | 5 | 2 | 0 | 0 |
| AMC | 11 | 11 | 0 | 0 | 0 |
| SVC | 12 | 11 | 1 | 0 | 0 |
| ENG | 7 | 5 | 0 | 2 | 0 |
| SLA | 10 | 6 | 0 | 4 | 0 |
| DSH | 8 | 7 | 1 | 0 | 0 |
| RPT | 9 | 8 | 1 | 0 | 0 |
| ADM | 11 | 11 | 0 | 0 | 0 |
| TEAM | 9 | 2 | 0 | 7 | 0 |
| GEN | 10 | 8 | 2 | 0 | 0 |
| SEC | 8 | 6 | 0 | 2 | 0 |
| NFR | 9 | 4 | 0 | 5 | 0 |
| E2E | 16 | 14 | 2 | 0 | 0 |
| P2 | 5 | 1 | 4 | 0 | 0 |
| **Total** | **336** | **287** | **18** | **30** | **1** |

(Failed = TC-OPP-004 in runs 2 and 3; it passes after the fix.) The 5 helper tests (coverage check and drift guards) passed in every run, so the Playwright totals are 310 + 30 + 1 = 341.

## Known gaps (18 expected-fail cases) with confirmed-at evidence

Each line is the `known-gap-evidence` annotation of the case in the JSON: the matcher message and the spec line where the spec-correct assertion failed.

| Case | Title | Evidence |
|---|---|---|
| TC-APR-010 | Payment-term / credit-term approvals | a CreditTerms approval for the PO or quotation @ apr.spec.ts:328:70 |
| TC-AST-006 | Installation / commissioning report | GET /modules/installations @ ast.spec.ts:168:66 |
| TC-AST-007 | Installation workflow (Planned/In progress/Installed/Pending sign-off/Closed) | GET /modules/installations @ ast.spec.ts:221:66 |
| TC-DSH-007 | Target vs achievement tile | a monthly target vs achievement entry in the My-day kpis (keys: dueToday, overdueCount, newLeadsToContact, leadsPastSla, quotesAwaitingReply, posExpectedThisMonth, quarterTarget) @ dsh.spec.ts:175:126 |
| TC-E2E-013 | Opportunity lost → nurture/reactivation | reactivation task (activity on the opportunity) or nurture-sequence enrolment after Lost / Budget @ e2e.spec.ts:807:139 |
| TC-E2E-014 | Quality check → Rework Production | Rework action at Quality check @ e2e.spec.ts:908:83 |
| TC-GEN-001 | Global search by company, phone, email, GSTIN, IDs, quotation/PO number, serial | global search finds the record for every key @ gen.spec.ts:83:70 |
| TC-GEN-003 | Saved filters and column selection | saved filter is listed after reload @ gen.spec.ts:367:93 |
| TC-LEAD-006 | Automatic assignment (round-robin / territory / product / industry) | owners: 5d33ca3d-6d50-4358-8255-e7cf692bb6a2,5d33ca3d-6d50-4358-8255-e7cf692bb6a2,5d33ca3d-6d50-4358-8255-e7cf692bb6a2,5d33ca3d-6d50-4358-8255-e7cf692bb6a2 @ lead.spec.ts:645:80 |
| TC-P2-001 | Dealer / Channel partner management | partner master module (dealers 403, partners 403) @ p2.spec.ts:36:143 |
| TC-P2-002 | Tender / PSU sales management | GET /modules/tenders @ p2.spec.ts:44:52 |
| TC-P2-003 | ERP / accounting sync | GET /modules/erp @ p2.spec.ts:56:44 |
| TC-P2-004 | Telephony & calendar integration | expect(received).toEqual(expected) // deep equality @ p2.spec.ts:76:70 |
| TC-PAY-012 | Block configurable actions if credit rule requires | dispatch against an order with an overdue milestone is refused @ pay.spec.ts:382:90 |
| TC-QUO-017 | Quotation auto-expires after validity date | expect(received).toBe(expected) // Object.is equality @ quo.spec.ts:641:20 |
| TC-RPT-006 | Scheduled email delivery (daily/weekly/monthly) | a scheduled run (ReportSchedule row) is recorded for a Daily report @ rpt.spec.ts:274:124 |
| TC-SVC-011 | Repeated failures flag asset/account | asset / account carries a repeat-failure flag, or management is notified @ svc.spec.ts:180:97 |
| TC-VIS-009 | Visit reminder before scheduled time | a reminder notification exists for the upcoming visit @ vis.spec.ts:253:93 |

## Skipped cases (30), by reason

| Reason | Count | Cases |
|---|---|---|
| wall-clock | 7 | TC-DEM-008, TC-LEAD-024, TC-OPP-014, TC-SLA-002, TC-SLA-003, TC-SLA-004, TC-SLA-008 |
| external-delivery | 13 | TC-ENG-006, TC-ENG-007, TC-ENV-004, TC-ENV-015, TC-LEAD-028, TC-PAY-007, TC-SEC-007, TC-TEAM-001, TC-TEAM-003, TC-TEAM-004, TC-TEAM-005, TC-TEAM-006, TC-TEAM-008 |
| perf | 1 | TC-NFR-001 |
| manual-visual | 4 | TC-NFR-005, TC-PO-013, TC-RFQ-008, TC-VIS-010 |
| infra | 4 | TC-NFR-007, TC-NFR-008, TC-SEC-006, TC-TEAM-009 |
| cross-browser | 1 | TC-NFR-009 |

(The task brief estimated 29 skips; the workbook catalogue `cases.json` and the run contain 30.) No case was converted from auto to skip during this task.

## Triage of the full runs

| Test | Run | Class | Cause | Fix |
|---|---|---|---|---|
| TC-ADM-007 | 1 | test bug (timing) | "Couldn't load automation rules" was asserted hidden within 2 s of navigation, which passes while the page is still loading, so the `knownDefect` D-124 reported "appears fixed". Violated the "positive loaded signal before an absence assertion" rule. Passed in isolation. | `dcf531b`: the list response status (403 today) is asserted first inside the `knownDefect`. |
| TC-OPP-004 | 2, 3 | harness race (cross-spec timing) | After "Advance stage" the detail page briefly re-renders with neither the progress bar nor the badge; `ModuleDetail.statusText()` fell into the badge branch and blocked on a non-existent element for the whole 20 s poll window. The PATCH itself answered 200 in 91 ms (trace). Reproduced reliably when TC-ADM-011 ran right before; passes in isolation. | `ec1abe9`: statusText waits for a status element and reads with 3 s timeouts so the poll retries; `advanceStage` waits for the PATCH and asserts 200. (`f5c60f4` 20 s poll window; `4547301` prune all timers at setup, see below.) |
| TC-PAY-003 | regression pass | timing / accumulation | The date sweep slows as SLA timers accumulate; the SLA-22 timer start took more than 30 s once. Passes in isolation (36 s). | `18490c2`: 75 s wait for the timer (readiness wait, assertions unchanged), test timeout 180 s; same for PAY-010. |
| TC-SVC-005 | regression pass | infra | The machine went to sleep during the test (6.0 h duration), the detail page never loaded. Passes in isolation. | none needed |

Other findings during triage:

- The backend burns about 85 % of a core even when idle: `SLA_TICK_MS` / `SLA_DATE_SWEEP_MS` = 5 s and every tick evaluates all open timers and sweeps all dated records of an ever-growing, never-reset test DB. It was observed with 3,700 open timers and persisted with 119, so timers are not the only cost. This is the root of the 30 s+ waits above; the specs now wait on readiness with generous windows. `4547301` makes the setup prune delete every E2E-org SLA timer (setup runs before any spec), which keeps one run's backlog from slowing the next.
- Run 1 started from a freshly pruned DB; runs 2 and 3 started with the previous run's timers. During setup the prune deletes rows the engine is evaluating, producing about 1,200 harmless "Record to update not found" SlaEngineService errors in the backend log (the engine catches them per timer).
- Stale pins reconciled earlier (D-40, D-71, D-95 RESOLVED by `d1e2f72`) held in all runs.

## Configuration restoration (checked after the last run, genxcrm_test only)

No backup files remain in `e2e/.auth` (margin-rules, approval-rules, sla-throwaway, admin-config). Org A (`genxcrm-e2e-mfg`) was compared with the never-mutated Org B (`genxcrm-e2e-mfg-b`), which is seeded with the same defaults: master values 103 / 103, approval rules 8 / 8, SLA policies 22 / 22, business calendar 1 / 1, holidays 5 / 5, field permissions 6 / 6, role permissions 149 / 149, automation rules 0, document templates 0; `EXCEPT` queries over every column of those tables, in both directions, return 0 rows. No `E2E-` SLA policy, master value or holiday exists. Sales Executive on `leads`: create / read / update = true, delete / export = false, record access OWN. Approval rules: CreditTerms 45-60 Accounts, 60-120 Director; Discount 0-5 Salesperson, 5-10 Sales Manager, 10-15 Sales Head, 15-100 Director; Margin 0-15 Director, 15-20 Sales Head; all active.

## Defect register (139 defects, 3 RESOLVED)

Defects are collected, not fixed: this suite never changes product code, apart from a single `data-testid` added in `ModuleDetailPage.tsx`. Full text with evidence for every defect is in [`docs/MANUFACTURING-E2E-DEFECTS.md`](MANUFACTURING-E2E-DEFECTS.md). D-40, D-71 and D-95 were fixed by commit `d1e2f72` (SLA date-sweep) and verified on 2026-10-04. Run 4 added D-139 (D-140+ unused).

| Id | Title | Area / case | Status |
|---|---|---|---|
| D-1 | Export op not enforced server-side: GET /modules/<key>/export returns 200 for any role with read access (spec §26: exports must respect permissions). | ENV-005 | OPEN |
| D-2 | List pages render Export and New buttons regardless of the role's create/export ops. | ENV-005 | OPEN |
| D-3 | No server-side logout: old JWT still returns 200 after sign-out (spec §27 session security). | ENV-014 | OPEN |
| D-4 | A module a role cannot read shows generic "Couldn't load <title>." (API 403) instead of a restricted banner; only Costing shows the banner; sidebar is not permission-filtered. | ENV-005, minor | OPEN |
| D-5 | "Costing is restricted." banner only shows until the fieldPermissions fetch returns; roles that cannot read fieldPermissions (Sales Executive etc.) get 403, the hook fails open, and the settled pag... | ENV-012 | OPEN |
| D-6 | Lead create drawer cannot save an Estimated value: money/number fields are posted as strings and the API rejects them (400 "value must be a number conforming to the specified constraints"); drawer ... | LEAD-001 | OPEN |
| D-7 | Detail "SLA" tab always shows "Couldn't load SLA info.": the page calls GET /modules/<key>/<id>/sla and the backend has no such route (404). | LEAD-007/023 | OPEN |
| D-8 | Duplicate warning on the create form misses email duplicates (and a company duplicate once a fresh phone is also filled): the blur check searches by the first filled key (phone > email > company) w... | LEAD-004 | OPEN |
| D-9 | Server does not detect duplicate leads: POST /modules/leads with an existing phone returns 201 with no duplicate flag/existing id (spec §37 / flow "Duplicate -> merge"); no merge path. | LEAD-004 | OPEN |
| D-10 | Qualify has no BANT guard: a Contacted lead with empty Budget/Authority/Need/Timeline is qualified (spec/flow: BANT must be captured before Qualified). | LEAD-010 | OPEN |
| D-11 | A Disqualified lead is still returned by the default lead list (GET /modules/leads?search=...), spec: removed from active views. | LEAD-012 | OPEN |
| D-12 | Convert dialog never shows a duplicate notice / "Open existing": it silently re-submits against the existing account (and existing contact) found by name/GSTIN/phone/email (spec §32: UI shows 'Open... | LEAD-018 | OPEN |
| D-13 | Convert dialog has no way to pick an existing contact on the chosen account (only the API takes contactId); spec: "pick existing account and contact C1". | LEAD-021 | OPEN |
| D-14 | Converted opportunity record carries no probability ('prob' undefined; Probability field blank), spec: stage Qualified = 10%. | LEAD-015 | OPEN |
| D-15 | Accounts and contacts created by lead conversion get no owner: the converting Sales Executive (own-records access) gets 404 reading the account/contact they just created (opportunity owner is carri... | LEAD-015 | OPEN |
| D-16 | Leads list "Response SLA" column renders the sla object as "[object Object]" instead of the remaining time ("Due in 2h") (spec §5 SLA column). | LEAD-023 | OPEN |
| D-17 | Business-hours SLA windows are computed in UTC; the calendar's timezone (Asia/Kolkata) is ignored (documented simplification in sla-duration.util.ts), so first-response targets shift by 5.5h vs the... | LEAD-023/024 | OPEN |
| D-18 | Lead form Owner field is a plain text box that takes a raw user id (no user picker); list/detail also show owners as UUIDs (spec §5 manual assignment "choose another owner"). | LEAD-005 | OPEN |
| D-19 | Account create form's duplicate warning misses GSTIN-only duplicates: the blur check searches with the list search, which only matches name/short, so a duplicate GSTIN with a different name shows n... | ACC-003 | OPEN |
| D-20 | Server accepts duplicate accounts on manual create: POST /modules/accounts with an existing GSTIN/name returns 201 with no duplicate flag/existing id (dedupe exists only in lead conversion). | ACC-003 | OPEN |
| D-21 | Plants cannot be added: the Plants tab (TableTab) is read-only with no add control and no backend route creates a Plant (accounts.service only reads the Plant table), so "add Plant 1 / Plant 2" is ... | ACC-004 | OPEN |
| D-22 | Reassign owner prompt is a free-text textarea taking a raw user id (ask type 'owner' falls to the textarea branch of ActionDialog), no user picker (same root cause as D-18). | ACC-006 | OPEN |
| D-23 | No audit trail: the detail "Audit trail" tab calls GET /modules/<key>/<id>/audit, which the backend does not implement, so it always shows "Couldn't load the audit trail." (spec §4 ownership audit:... | ACC-006 | OPEN |
| D-24 | Account list search matches only name/display name; GSTIN and city searches return nothing (spec §4 search by GSTIN / name / city). | ACC-008 | OPEN |
| D-25 | Account drawer cannot save its optional fields Sub-industry, Credit terms, Tags: registry keys sub_industry / credit are not DTO properties (subIndustry / creditTerms) and tags is posted as a strin... | ACC-001 | OPEN |
| D-26 | Contact "Plant" is a free-text box, not a list of the chosen account's plants (spec §4 multi-plant: only plants of the chosen account are offered); any string is accepted and not linked to a Plant ... | CON-004 | OPEN |
| D-27 | Contact create form's duplicate warning misses email-only duplicates (check searches by the first filled key with the contact list search, which matches name/phone only). | CON-003 | OPEN |
| D-28 | Server accepts duplicate contacts (same phone on the same account): POST /modules/contacts returns 201, no duplicate flag. | CON-003 | OPEN |
| D-29 | No UI control to deactivate a contact: the edit drawer hides the status field and the contact detail page has no action; Inactive can only be set via PATCH. | CON-005 | OPEN |
| D-30 | Inactive contacts are still returned by the default contact list/search (spec: not offered for new transactions); only an explicit ?status=Active filter excludes them. | CON-005 | OPEN |
| D-31 | Contact drawer's Account field (type 'ref') is a plain text box requiring the raw account UUID, no account picker (same pattern as D-18). | CON-001 | OPEN |
| D-32 | Account 360 tabs hide rows from the account/opportunity owner: for a Sales Executive who owns the account, opportunity and quotation, the Orders and Payments tabs return 200 with an empty page ("No... | ACC-007 | OPEN |
| D-33 | Opportunity cannot be created from the UI: the drawer hides the Stage field (status key excluded from the form) but CreateOpportunityDto requires `stage`, so POST /modules/opps from the drawer is a... | OPP-001 | OPEN |
| D-34 | Detail "Days in stage" is always blank ("—"): the registry field key is `inStage` but the API returns `daysInStage` (age works, "Opportunity age (days)" shows 0). | OPP-005 | OPEN |
| D-35 | Closed opportunities can be re-staged: PATCH /modules/opps/:id {stage:"Qualified", nextAction, nextActionDate} on a Lost opportunity returns 200 and re-opens it (spec: further transitions on Won/Lo... | OPP-011 | OPEN |
| D-36 | Activity drawer cannot save Outcome / Next action fields on create: CreateMfgActivityDto has no `outcome`/`nextAction`/`nextActionDate`, so filling the Outcome in the "Log activity" drawer gives 40... | OPP-015/ACT | OPEN |
| D-37 | A new opportunity has no stagnation SLA timer: SLA-03/04 start on 'Stage entered' only from a stage change, never at creation (record `sla` is null until the first stage change), so a deal that nev... | OPP-013 | OPEN |
| D-38 | No overdue indicator in the Activities list: an Open activity with a past due date renders exactly like a future one (plain date, gray/blue pills, no red or "Overdue" text); only the dashboard acti... | ACT-007 | OPEN |
| D-39 | The Activities tab on an opportunity/account is not a timeline: it lists activities only (ID, subject+type, account, due, priority, owner UUID, SLA, status): no outcome, no visits/demos/stage chang... | ACT-009 | OPEN |
| D-40 | SLA-05 'Next action overdue' never starts: an opportunity with a past nextActionDate gets no timer from the date sweep within 12s (5s sweep interval in E2E), although the same sweep starts SLA-06 t... | ACT-003 | RESOLVED |
| D-41 | A new RFQ is stored with revision 0 (schema default; RfqsService.create never sets it) and the Rev column/field shows 0; spec: revision 1. | RFQ-001 | OPEN |
| D-42 | The clarification note ('clarification') and the Not feasible reason ('nf') are required by the action but never stored: performAction only writes the status and the Rfq model has no field for them... | RFQ-004/006 | OPEN |
| D-43 | RFQ revision history keeps only a counter row (number, note, author, time): the superseded specification is not snapshotted, so a previous revision cannot be viewed (spec: previous revision retaine... | RFQ-007 | OPEN |
| D-44 | No in-app notification is created for RFQ events: the sales owner (opportunity owner) gets nothing when the engineer requests a clarification; notifications.create is called by the SLA engine escal... | RFQ-004/010 | OPEN |
| D-45 | Costing is not gated by technical feasibility: POST /modules/costing for an opportunity whose RFQ is still Received returns 201 (create only validates the opportunity); no rule or UI block (spec §7... | RFQ-009 | OPEN |
| D-46 | No prompt after a successful trial / customer approval to move the opportunity to 'Solution proposed': the evaluation page shows nothing, and the opportunity stays at 'Demo / trial' until the user ... | DEM-006 | OPEN |
| D-47 | Evaluations are own-record scoped (likely RFQs and visits too; verified for evaluations only) for the Application Engineer (role SALES_REP): GET /modules/demos/:id of an evaluation requested by a S... | DEM-002 | OPEN |
| D-48 | The generic Edit drawer cannot save an evaluation: it PATCHes the whole record (id, orgId, status, isDeleted, createdAt, updatedAt, sla) and the API answers 400 "property id should not exist ..." s... | DEM-007 | OPEN |
| D-49 | Detail field tabs print date fields as the raw ISO timestamp ("2026-10-04T00:00:00.000Z") instead of a formatted date (list columns use formatDate); seen on the Sample logistics tab. | DEM-007 | OPEN |
| D-50 | The approvalRules module answers 403 ("Your role does not have 'read' access to 'approvalRules'.") to every role of the E2E org incl. | CST-007 | OPEN |
| D-51 | Submit computes total / gm / gmPct but returns them only in its own response: they are not stored, so GET /modules/costing/:id has no total, gm or gmPct and the detail "Sheet" tab (Total cost / Gro... | CST-002 | OPEN |
| D-52 | A Rejected costing sheet cannot be submitted again: the UI offers Submit for Draft/Rejected but POST action Submit returns 400 "Cannot submit a costing sheet in status 'Rejected'." (service accepts... | CST-009 | OPEN |
| D-53 | The quotation Line items tab has no product picker: Product ID is a raw text box taking the product UUID (same pattern as D-31), so "visible in quotation product pickers" and "inactive product not ... | PRD-001/005 | OPEN |
| D-54 | No hierarchy filters on the product list: GET /modules/products ignores ?category= (only search by model/SKU and status filter), and the UI has no category/family control (spec §8: hierarchy reflec... | PRD-002 | OPEN |
| D-55 | Inactive products are not refused on new quotations: PATCH /modules/quotes/:id {lines:[{productId:<Inactive product>}]} returns 200 (assertLineProductsInOrg only checks the org; archived products a... | PRD-005 | OPEN |
| D-56 | A Sales Executive's product detail still renders the restricted fields' labels "Standard cost" and "Minimum selling price" with a "—" as if unset (values are masked to null in the API; keys stay in... | PRD-004, minor | OPEN |
| D-57 | Approving/rejecting a costing sheet leaves its Approval record in 'Requested' (linkage in the other direction, cf. | CST-009, noted by 8b implementer, not asserted | OPEN |
| D-58 | Reject reason (`rej`) on a costing sheet is not stored. | CST-009 | OPEN |
| D-59 | Archiving a product leaves the UI on the stale detail page (no redirect). | PRD-006, observed only — not asserted | OPEN |
| D-60 | Product detail prints money values unformatted (no en-IN grouping, spec §31 localization). | PRD-001, observed only — not asserted | OPEN |
| D-61 | Field-masked product fields come back as null rather than absent keys (still leak the key names). | PRD-004 | OPEN |
| D-62 | A role without read access to costing gets 403 "Your role does not have 'read' access to 'costing'." (permission guard); the case expects "Costing is restricted." (that text only exists in the serv... | CST-011, minor | OPEN |
| D-63 | Quotation tax / warranty / lead-time defaults are not pre-filled from the product master: adding a line for a product with leadTime '6 weeks' / warrantyMonths 12 leaves the quotation's warranty and... | QUO-001 | OPEN |
| D-64 | The UI does not show the below-minimum-price warning: Submit for approval toasts only "Submit for approval done." and drops the response's `warnings` (API returns 'Line for <sku> is priced below mi... | QUO-007 | OPEN |
| D-65 | The quotation Versions tab lists only the opened version's own "V<n> created" entry, not the chain (V2's tab does not show V1; the detail "Revises" field uses key `parent` while the API returns `pa... | QUO-011 | OPEN |
| D-66 | The quotation record has no `total`: the detail "Grand total" field and the list's Total column are blank; the grand total exists only in the PDF. | QUO-015 | OPEN |
| D-67 | An issued (Sent) quotation is not immutable: PATCH /modules/quotes/:id with paymentTerms / validUntil / termsAndConditions returns 200 and changes the Sent version in place (only `lines` is guarded... | QUO-019 | OPEN |
| D-68 | Discount band boundaries are off by one versus spec §14 wording: rules match min <= v < max, so 5% -> Sales Manager, 10% -> Sales Head, 15% -> Director (spec: Salesperson / Sales Manager / Sales He... | QUO-020 | OPEN |
| D-69 | The quotation detail has no Approve / Reject buttons (registry quotes actions omit them; the service supports both): an 'Approval pending' quotation can only be approved or rejected through the API... | QUO-009/010 | OPEN |
| D-70 | No follow-up task is created when a quotation is marked Sent: no Activity is created for the opportunity (SLA-12 timer is started, spec §13: follow-up task). | QUO-009 | OPEN |
| D-71 | SLA-13 'Quotation expiry reminder' never starts: a Sent quotation valid for 3 days has no SLA-13 timer after 20 s of date sweeps (same `not: null` on a required DateTime as D-40); SLA-12 runs. | QUO-016 | RESOLVED |
| D-72 | The UI saves the quotation PDF as `quotes-<id>.pdf`, ignoring the server's Content-Disposition `Quotation-<id>-v<version>.pdf` (the API header is correct). | QUO-014 | OPEN |
| D-73 | The rupee sign in the PDF is not rendered: the Grand total line extracts as "Grand total: ¹34,72,500" (the built-in Helvetica font has no ₹ glyph). | QUO-014 | OPEN |
| D-74 | The Approvals list "Approval SLA" column renders the sla object as "[object Object]" instead of the remaining time ("Due in 2d") - same root cause as D-16 (the API record's sla is {l,t}; the runnin... | APR-001 | OPEN |
| D-75 | The Approval detail shows "Matched rule", "Requested on" and "Level" as "-": the registry field keys are `rule` / `requested` / `level` while the API returns `matchedRule` / `requestedAt` (level is... | APR-001 | OPEN |
| D-76 | Approving an Approval record does not move the quotation it belongs to: the quotation stays 'Approval pending' and Mark sent is refused; only the quotation's own Approve (API-only, cf. | APR-006 | OPEN |
| D-77 | The Administration -> Approval rules tab shows "Couldn't load approval rules." for Super Admin (GET /modules/approvalRules is 403), so the seeded rules cannot be listed or edited from the browser; ... | APR-008/009, extends D-50 | OPEN |
| D-78 | The PO vs Quotation compare table always shows Quantity and Products as 'n/a' (the PO stores no quantity/products); spec §15 compares quantity, price, tax and specifications. | PO-003 | OPEN |
| D-79 | A material mismatch does not stop acceptance: a Rs 1 PO against a Rs 10 L quotation (Value = Mismatch) is accepted by the API (201, no warning in the response) and the UI Accept PO has no confirmat... | PO-004 | OPEN |
| D-80 | '45 days credit' produces a single 100% milestone named 'Retention' (due PO date + 45 days is correct); a credit period is a plain payment, not a retention. | PO-008 | OPEN |
| D-81 | Accept PO is not safe against a double click / concurrent requests: two simultaneous Accept PO calls both return 201 and create TWO sales orders with six milestones for one PO (the status check and... | PO-010 | OPEN |
| D-82 | Registering a PO notifies nobody: neither the Sales Manager nor Commercial inbox (GET /notifications) gets an entry mentioning the PO (SLA escalations are the only notification producer). | PO-012 | OPEN |
| D-83 | The sales-order "Operations acknowledgement" field and the list's "Ops ack" column read registry key `ack` but the record carries `ackStatus`, so the acknowledgement state (Pending / Acknowledged) ... | SO-001/002 | OPEN |
| D-84 | Accept PO creates the sales order straight through Prisma, bypassing SalesOrdersService.create, so SLA-16 'Operations handover acknowledgement' never starts for orders created from a PO (order `sla... | SO-001/002/003 | OPEN |
| D-85 | A whitespace-only serial ("   ") is accepted by Advance status to Commissioned (API 201) and an installed asset with a blank serial is created; the UI dialog itself treats it as blank. | SO-005 | OPEN |
| D-86 | Warranty is a fixed +1 year (code) instead of the product's warranty months (product with warrantyMonths 24: warrantyEnd = start + 365 days); also the order stores only free text `products`, so the... | SO-006 | OPEN |
| D-87 | Create dispatch from a sales order opens the prefilled drawer (order + account correct) but saving fails for Operations: the role holds only read/update on dispatch (seed 'sorders,dispatch:RU'), th... | SO-008 | OPEN |
| D-88 | Sales-order references are mutable: Operations (update right) can PATCH purchaseOrderId and value of an order (200) and re-point it to another PO. | SO-011 | OPEN |
| D-89 | Read-only roles are offered change controls: a Sales Executive (read-only on sales orders) sees the Advance status / Acknowledge handover buttons on the order detail (the server answers 403 "Your r... | SO-009 | OPEN |
| D-90 | The serial prompt for Commissioned never opens: ModuleDetailRoute shows the dialog only if the error message contains "serial", but the UI only receives axios's generic "Request failed with status ... | SO-004/005/006 | OPEN |
| D-91 | Operations holds accounts:R but with own-record scope it gets 404 for any account it does not own: the account detail shows "Couldn't load this record." (cannot reach Account -> Installed assets, n... | SO-006 | OPEN |
| D-92 | Creating a dispatch notifies nobody: the sales owner of the order (Sales Executive who owns PO/order) has no inbox entry mentioning the dispatch id or invoice 2 s after creation (SLA escalations ar... | DSP-006 | OPEN |
| D-93 | Payment milestones never carry `received` / `balance`: after a Rs 1,00,000 receipt on a Rs 3,00,000 milestone (status 'Partially received', Receipt row exists) the detail "Received amount" and "Bal... | PAY-002/003/011 | OPEN |
| D-94 | A milestone is never set to 'Overdue': an unpaid milestone due yesterday stays 'Not due' after a 30 s sweep window (no code assigns 'Overdue' anywhere), so the Reminders & escalations tab shows onl... | PAY-010 | OPEN |
| D-95 | SLA-22 'Payment collection' never starts: the 'Due date' date sweep fails for payment milestones with the same Prisma `not: null` on the required DateTime `dueDate` as D-40 (backend log: "Date-trig... | PAY-003/010 | RESOLVED |
| D-96 | No payment follow-up Activity is created for an overdue milestone (flow chart: Overdue creates a follow-up Activity): the account's Activities tab (GET /modules/accounts/:id/related/acts) lists onl... | PAY-010 | OPEN |
| D-97 | The Send reminder rejection reaches the user only as the generic axios text "Request failed with status code 400" in the toast, not the server message "No contact with an email address is on file f... | PAY-008 | OPEN |
| D-98 | Over-payment is accepted silently: Rs 3,50,000 on a Rs 3,00,000 milestone -> 'Received' (>= rule, as documented) with no warning in the response or UI; the Rs 50,000 excess is visible nowhere (reco... | PAY-006 | OPEN |
| D-99 | The sales order's Payments tab is a plain milestone table: there is no summary of total / received / outstanding / next due (no "Outstanding" text anywhere on the tab). | PAY-011 | OPEN |
| D-100 | Field security 'Payment receipts' is not enforced: the seeded restriction lists SALES_EXECUTIVE (not DIRECTOR), but the owning Sales Executive reads `amount` unmasked on GET /modules/payments/:id, ... | PAY-013 | OPEN |
| D-101 | Payment milestones are own-record scoped by `ownerId` for Role.SALES_REP callers (PaymentMilestonesService.scopeFilter checks only `Role.SALES_REP`, which is what the manufacturing non-Director use... | PAY-001 | OPEN |
| D-102 | Service tickets are own-record scoped by `engineerId` for every non-Director caller (ServiceTicketsService.scopeFilter checks only `Role.SALES_REP`), so the Service Manager (service CRUDE) gets 404... | SVC-001/003/010, AST-003 | OPEN |
| D-103 | The installed-asset coverage status cannot be edited: UpdateInstalledAssetDto has no `status`, PATCH /modules/assets/:id {status} = 400 "property status should not exist" (status is also forced to ... | AST-005 | OPEN |
| D-104 | Coverage statuses Quoted and Negotiation are unreachable, hence Renewed is too: no action targets them, UpdateCoverageDto has no `status` (PATCH {status:'Quoted'} = 400 "property status should not ... | AMC-007/008/010 | OPEN |
| D-105 | No automatic Due-soon handling: a coverage ending in 60 days gets its SLA-21 'Renewal reminders' timer from the date sweep (works once the sweep `not: null` bug is fixed; the sweep can lag 25-30 s)... | AMC-009 | OPEN |
| D-106 | A ticket's Coverage (In warranty / Under AMC / Chargeable) and Chargeable flag are manual, optional fields that nothing derives: a ticket on an asset under warranty and one raised after the warrant... | SVC-012 | OPEN |
| D-107 | Service ticket UI field-key / control mismatches: the Assign engineer prompt is a free-text box in which a raw user id has to be typed (ActionDialog renders only select or textarea; the `owner` ask... | SVC-003/005 | OPEN |
| D-108 | Nurturing is not wired for the Manufacturing workspace: GET /modules/nurturing and /modules/templates answer 404 "Module '<key>' is not available" (no adapter), the sidebar opens the generic EdTech... | ENG-001/002/003/004 | OPEN |
| D-109 | There is no template approval workflow for Email templates: they are saved with status null (no Draft / Pending / Approved / Rejected), POST /templates/:id/submit = 400 "Only WhatsApp templates can... | ENG-005 | OPEN |
| D-110 | The complaint types differ from the spec (§20: Breakdown, Calibration, Preventive visit): the New-ticket select and CreateServiceTicketDto offer exactly "Breakdown, Calibration, Preventive maintena... | SVC-002 | OPEN |
| D-111 | Administration -> SLA Policies shows only the line "Request failed with status code 403" for Super Admin (GET /modules/slaPolicies is 403 for every role), so the 22 seeded policies cannot be listed... | SLA-001/009, extends D-7/D-50/D-77 | OPEN |
| D-112 | The /notifications page of the Manufacturing workspace is the EdTech "New leads" list (useNotifications; empty state "No new leads."), not the SLA alert inbox: an SLA breach notification is only re... | SLA-006 | OPEN |
| D-113 | SlaEngineService.evaluateTimer calls pickTarget(targets) WITHOUT the context / entity value, so every tick (5 s in E2E) rewrites dueAt / status from targets[0]: the tighter money / priority / stage... | SLA-007 | OPEN |
| D-114 | SLA-04 'High-value deal attention' (cond 'Value >= Rs 1 Cr') starts for EVERY opportunity that changes stage: the money condition is only used to pick a target, never to decide whether the policy a... | SLA-007 | OPEN |
| D-115 | AutomationRun rows are never written (nothing in the backend creates them; automation-rules only reads), the automationRules module is 403 for every role (D-50 family) so no rule can be created / f... | SLA-010 | OPEN |
| D-116 | The Team toggle of the dashboard is visible to a Sales Executive: MfgDashboardPage hides it for user.mfgRole === 'SALES_EXECUTIVE' but the login / me user object has no mfgRole (payload: id, name, ... | DSH-001 | OPEN |
| D-117 | Two My-day tiles link to non-routes: 'Quotes awaiting reply' -> /quotes and 'POs expected this month' -> /opps (the pages are /quotations and /opportunities), so clicking them bounces back to the d... | DSH-005 | OPEN |
| D-118 | Report filters are not applied: mfg-reports builders take only (prisma, orgId), the Filters tab only stores dateRange / team / region / product / industry / source on the report row, and GET /modul... | RPT-002 | OPEN |
| D-119 | The Product and Industry filter fields are keyed fproduct / findustry in the registry but product / industry in CreateReportDto: PATCH {fproduct:'Weighbridge'} = 400 "property fproduct should not e... | RPT-002 | OPEN |
| D-120 | The report PDF contains the report name, the run date and the table only: a report saved with region West / date range This quarter shows neither filter in the PDF. | RPT-004 | OPEN |
| D-121 | The 25 seeded reports have no owner and ReportsService.scopeFilter limits every Role.SALES_REP caller (Sales Executive, Accounts) to reports they own, so a Sales Executive (seed grants Reports 'RE'... | RPT-005/008 | OPEN |
| D-122 | Report data is not role-scoped: builders receive only the org id, so a Sales Executive running the Pipeline report (a throwaway report he owns) gets the ORG-wide totals (all reps' deals) instead of... | RPT-008 | OPEN |
| D-123 | List export masks restricted fields by blanking the VALUES only: GET /modules/products/export as a Sales Executive keeps the cost and minPrice columns in the header (cells empty, values absent), in... | RPT-005 | OPEN |
| D-124 | Every Administration config module (masters, rolePermissions, fieldPermissions, businessCalendar, holidays, automationRules, docTemplates; also approvalRules, slaPolicies, automationRuns) answers 4... | ADM-001..008/010, extends D-7/D-50/D-77 | OPEN |
| D-125 | Master values are not consumed anywhere: the New lead Source select and the Mark lost reason select use the static registry arrays (SOURCES / LOST), so a new 'sources' / 'lost' master value never a... | ADM-001 | OPEN |
| D-126 | Stage probabilities of the Stages master are ignored: MfgDashboardService / report builders use the hard-coded STAGES constant, so with Negotiation set to 70 % in the master a Rs 20 L Negotiation d... | ADM-002 | OPEN |
| D-127 | The UI does not follow the permission matrix: with Create removed for Sales Executive on Leads the server rejects POST /modules/leads with 403 "Your role does not have 'create' access to 'leads'." ... | ADM-003 | OPEN |
| D-128 | Document templates are numbering-pattern records only: nothing reads them and the quotation form has no template control, so a saved template cannot be selected in a quotation. | ADM-008 | OPEN |
| D-129 | A non-admin (Sales Executive) who opens /administration directly gets the full Administration page (15 tabs, "Manager - read-only" badge and "Only Directors can change these settings" banner) with ... | ADM-011 | OPEN |
| D-130 | The CSV import wizard (Integrations -> CSV / Excel import) posts to the EdTech POST /leads/import and offers EdTech fields (Course / Program, Learning goal, ...): imported rows become generic Lead ... | TEAM-007 | OPEN |
| D-131 | A lost deal captures only the lost reason and a competitor select; there are no competitor price, competitor product, decision date or feedback fields on the form or in the API (PATCH {competitorPr... | P2-005 | OPEN |
| D-132 | A column choice made with the list's "Choose columns" popover is not persisted: useColumnPrefs calls GET / PUT /modules/<key>/column-prefs, which have no backend route (GET falls through to the rec... | GEN-003 | OPEN |
| D-133 | Saved filters cannot be saved or listed: the list's "Saved filters" popover calls GET / POST /modules/<key>/filters, which have no backend route (404; a toast "Couldn't save that filter." on save),... | GEN-003 | OPEN |
| D-134 | Long text is not truncated with a tooltip: the list cell of a text column (renderCell default) is a plain div (no overflow hidden / text-overflow ellipsis / nowrap, no `title`), so a 230-char accou... | NFR-004 | OPEN |
| D-135 | Money is never shown in the spec's full en-IN form (Rs 10,00,000): lists use the compact lakh / crore short form (Rs 10.0 L, Rs 1.25 Cr), record details print the raw number (1000000; opportunity d... | NFR-006, extends D-60 | OPEN |
| D-136 | A purchase order in 'Clarification required' cannot go back into the flow: Start verification is only allowed from Received (400 "Cannot Start verification a purchase order in status 'Clarification... | E2E-015 | OPEN |
| D-137 | The PO vs Quotation compare ignores line discounts: PurchaseOrdersService sums qty x unitPrice of the quotation lines (no discountPct), so a PO at the quotation's real total (Rs 9,20,000 for one Rs... | E2E-001 | OPEN |
| D-138 | The SLA 'Owner' escalation recipient is not resolved for activities (and visits, RFQs, tickets, payments, dispatches, approvals): OWNER_LOOKUP_DELEGATE in sla-engine.service.ts has no entry for tho... | E2E-009 | OPEN |
| D-139 | My day counts and lists archived (soft-deleted) Open activities (no `isDeleted: false`); the rows answer 404 when opened or cancelled and can crowd the 50-row action queue. | DSH-001 | OPEN |

### Full evidence for security / data-integrity defects

**D-1** (ENV-005) Export op not enforced server-side: GET /modules/<key>/export returns 200 for any role with read access (spec §26: exports must respect permissions). Evidence: task-6-report.

**D-2** (ENV-005) List pages render Export and New buttons regardless of the role's create/export ops.

**D-3** (ENV-014) No server-side logout: old JWT still returns 200 after sign-out (spec §27 session security).

**D-32** (ACC-007) Account 360 tabs hide rows from the account/opportunity owner: for a Sales Executive who owns the account, opportunity and quotation, the Orders and Payments tabs return 200 with an empty page ("No ... yet", no access error) although the account has an order and 3 milestones; sales orders / payment milestones are own-record scoped by the user who accepted the PO (Director in the test), not by account/opportunity owner. Installed assets tab does show the row. Spec: each tab lists the account's records (counts consistent with module lists). The tabs were asserted as Director for the comparison.

**D-61** (PRD-004) Field-masked product fields come back as null rather than absent keys (still leak the key names).

**D-81** (PO-010) Accept PO is not safe against a double click / concurrent requests: two simultaneous Accept PO calls both return 201 and create TWO sales orders with six milestones for one PO (the status check and the transaction are not atomic together). Sequential second accepts are refused correctly ("Cannot accept a purchase order in status 'Accepted'."). Evidence: po.spec TC-PO-010 (knownDefect D-81).

**D-101** (PAY-001) Payment milestones are own-record scoped by `ownerId` for Role.SALES_REP callers (PaymentMilestonesService.scopeFilter checks only `Role.SALES_REP`, which is what the manufacturing non-Director users carry), so the Accounts role (payments RUE) sees none of the milestones of an order whose PO was accepted by Commercial (list empty, GET detail 404) and can only work milestones it owns; the Director sees all three. Same family as D-32. Evidence: pay.spec TC-PAY-001 (knownDefect D-101); the PAY specs make the Accounts user the PO owner so it can act.

**D-102** (SVC-001/003/010, AST-003) Service tickets are own-record scoped by `engineerId` for every non-Director caller (ServiceTicketsService.scopeFilter checks only `Role.SALES_REP`), so the Service Manager (service CRUDE) gets 404 "Service ticket '<id>' not found." for every ticket that is not assigned to her: the ticket she just saved from New / Raise service ticket cannot be opened (detail "Couldn't load"), she cannot Assign engineer / Schedule visit / Close an Open ticket (404 on the action), and Asset -> Service history and Account -> Service are empty for her while the Director sees all tickets. Same family as D-32/D-101. Evidence: svc.spec TC-SVC-001 / 003 / 010 (knownDefect D-102); the SVC specs drive tickets as Director / Service Engineer.

**D-123** (RPT-005) List export masks restricted fields by blanking the VALUES only: GET /modules/products/export as a Sales Executive keeps the cost and minPrice columns in the header (cells empty, values absent), instead of leaving the restricted columns out of the file. Values are not leaked. Spec: restricted columns absent in the file. Evidence: rpt.spec TC-RPT-005 (knownDefect D-123). The module export permission (E flag) is still not enforced: GET /modules/accounts/export as Sales Executive (no E on accounts) = 200 (D-1).

**D-124** (ADM-001..008/010, extends D-7/D-50/D-77) Every Administration config module (masters, rolePermissions, fieldPermissions, businessCalendar, holidays, automationRules, docTemplates; also approvalRules, slaPolicies, automationRuns) answers 403 "Your role does not have '<op>' access to '<key>'." to EVERY role incl. Super Admin (not in MANUFACTURING_MODULE_KEYS permission seeding). Administration -> Roles & Permissions and Business Hours & Holidays show only "Request failed with status code 403"; Masters / Automation Rules / Document Templates show "0 of 0" + "Couldn't load <x>."; New Master value / New Document template saves are rejected 403, so nothing can be listed, added or edited from the UI. The effect of config changes is tested through the guarded db.ts withAdminConfig. Evidence: adm.spec TC-ADM-001..008, 010 (knownDefect D-124).

## How to re-run

```
docker start genxcrm-postgres-1 genxcrm-redis-1
cd backend && NODE_OPTIONS=--max-old-space-size=4096 npm run build
npx dotenv -e .env.e2e.local -e .env.local -e .env -- node dist/main      # keep running
cd ../frontend && npm run dev:e2e                                          # keep running
cd ../e2e
npx playwright test --project=setup
PLAYWRIGHT_JSON_OUTPUT_NAME=test-results/mfg-report.json npx playwright test --project=mfg --no-deps --reporter=list,json
npx playwright test --project=mfg-mobile --no-deps
```

Copy `test-results/mfg-report.json` out before running anything else: Playwright cleans `test-results/` at the start of every run.

## How to flip a gap

When a missing feature is built, the gap case fails with "gap appears fixed - flip automation to auto". Change that case's `automation` from `"gap"` to `"auto"` in `e2e/mfg/cases.json` and re-run it with `-g "TC-XXX-nnn"`. When a defect is fixed, the `knownDefect` wrapper throws "appears fixed - remove the wrapper": remove it (and the exact pin next to it) and mark the defect RESOLVED here and in `defects.md`.
