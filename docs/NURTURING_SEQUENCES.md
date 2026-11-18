# Nurturing Sequences

Nurturing sequences are automated, multi-step follow-up flows for leads. A sequence is
an ordered list of steps (email / WhatsApp / SMS / wait), each with a delay. Once a lead
is enrolled, a background engine walks them through the steps on schedule and sends each
message automatically — no manual action needed per step.

This doc explains the data model, how enrollment and execution work, the trigger system,
and how to operate and test it.

---

## Concepts

| Entity | What it is |
|--------|------------|
| **Sequence** (`NurturingSequence`) | A named, reusable flow. Has a `triggerEvent` and an `isActive` flag. Belongs to an org. |
| **Step** (`NurturingStep`) | One action in a sequence. Has a `type`, optional `subject`/`body`, an integer `stepOrder`, and a `delayDays`. |
| **Enrollment** (`NurturingEnrollment`) | A single lead's progress through a sequence. Tracks `currentStep`, `status`, and `nextRunAt`. |

### Step types
- `email` — sends an email (`subject` + `body`) via `CommunicationsService.sendEmail`.
- `wait` — sends nothing; it only contributes its `delayDays` before the next step.

> **WhatsApp and SMS are temporarily disabled** — only email delivery is available for
> now. They are removed from the step-type picker (`frontend/src/pages/Nurturing.tsx`)
> and rejected by the API (`CreateStepDto` allows only `email`/`wait`). The engine still
> contains `sms`/`whatsapp` send branches so any pre-existing steps keep working; to
> re-enable, add them back to `STEP_TYPES` in both the page and the DTO.

### Placeholder interpolation
Step `subject` and `body` may contain `{{name}}`, `{{course}}`, `{{email}}`, and
`{{phone}}` placeholders. When a step runs, the engine replaces them with the lead's
values (a missing/null field becomes an empty string), so each message reads naturally
per lead.

### `delayDays` semantics
`delayDays` is the wait **before** a step runs, measured from when the previous step ran
(or from enrollment time, for the first step). A step with `delayDays: 0` runs on the
next engine tick — effectively immediately.

Example sequence:

| stepOrder | type | delayDays | Effect |
|-----------|------|-----------|--------|
| 0 | email | 0 | Welcome email sent right after enrollment |
| 1 | wait | 2 | Wait 2 days |
| 2 | email | 0 | Follow-up email 2 days after the welcome |
| 3 | email | 3 | Final email 3 days after the follow-up |

---

## Enrollment lifecycle

An enrollment has a `status`:

- `active` — currently progressing through steps.
- `completed` — finished the last step (or the sequence had no steps).
- `removed` — soft-removed (un-enrolled). Never hard-deleted.

```
                 enroll
   (none) ─────────────────▶ active ──(last step done)──▶ completed
      ▲                        │
      │ enroll                 │ removeEnrollment
      │ (reactivates)          ▼
   removed ◀────────────────  removed
```

When a lead is enrolled (manually or via a trigger), `startEnrollment` runs:
1. Look up the sequence's first step (ordered by `stepOrder`).
2. If a step exists → `status: 'active'`, `currentStep: 0`,
   `nextRunAt = now + firstStep.delayDays`.
3. If the sequence has **no steps** → `status: 'completed'` immediately.

Re-enrolling a `removed` lead reactivates the same enrollment record (resets
`currentStep` and `nextRunAt`). Enrolling a lead that is already `active` is rejected
(`ConflictException`) on the manual path, and silently skipped on the trigger path.

`nextRunAt` is the heart of scheduling: it's the timestamp at which the lead's
**current** step becomes due.

---

## The execution engine

A background **tick** advances enrollments. There is no per-step timer; instead a single
repeatable job runs on an interval and processes everything that's due.

### How a tick works (`NurturingService.executeDueEnrollments`)
1. Query enrollments where `status = 'active'` **AND** `nextRunAt <= now` **AND** the
   parent sequence is `isActive: true`. (Pausing a sequence via `isActive: false`
   freezes all its enrollments.)
2. For each due enrollment, run its current step (`runStep`):
   - Send the message for the step's `type` (or do nothing for `wait`).
   - Advance: `currentStep += 1`.
   - If a next step exists → set `nextRunAt = now + nextStep.delayDays`.
   - Otherwise → `status: 'completed'`, `completedAt: now`, `nextRunAt: null`.
3. Each enrollment is processed in its own `try/catch`; one failed send is logged and
   does not stall the rest of the batch.

### Scheduling (`NurturingProcessor`)
- Uses the existing **Bull + Redis** infrastructure (same setup as the assignment
  queue — no extra dependency).
- On startup (`onModuleInit`) it registers one repeatable job named `tick` with a fixed
  `jobId` (`nurturing-tick`), so there is exactly one schedule across restarts.
- Interval is `NURTURING_TICK_MS` (default `300000` = 5 minutes).
- Each fire calls `executeDueEnrollments()`.

> Because `delayDays` is day-granular, a 5-minute tick is plenty precise. A step never
> fires *early*; it may fire up to one tick interval *late*, which is irrelevant at day
> granularity.

### System actor for sends
The engine has no logged-in user, but `CommunicationsService` records `metadata.sentBy`.
The engine passes a sentinel actor (`id: 'nurturing-engine'`), so engine-sent messages
are attributable and distinguishable from rep-sent ones.

---

## Triggers (auto-enrollment)

Each sequence has a `triggerEvent` that controls how leads get enrolled:

| `triggerEvent` | Enrolls a lead when… |
|----------------|----------------------|
| `manual` | A user explicitly enrolls the lead from the UI. No automatic enrollment. |
| `lead_created` | A new lead is created (`LeadsService.create`). |
| `stage_change` | A lead's stage changes (`LeadsService.update` with a `stage` value). |

A `stage_change` sequence may optionally set `triggerStage` (a `LeadStage` value) to fire
only when the lead's **new** stage equals it, instead of on any stage change. Leave it
unset to match every stage change, as before.

`autoEnroll(leadId, orgId, trigger, stage?)`:
- Finds all `isActive` sequences in the lead's **org** whose `triggerEvent` matches.
- If `stage` is passed (the lead's new stage, for `stage_change`), also filters to
  sequences whose `triggerStage` is unset or equals that stage.
- Enrolls the lead into each (skipping any it's already actively enrolled in).

**`lead_created` fires for every lead source**, not just manual creation. It is called
from `LeadsService.create` (manual + CSV import) **and** from each integration service —
`FacebookService`, `GoogleService`, and `WebhookService` — right after they create a
lead. This is what makes the welcome email reach ad/webhook leads.

Auto-enrollment is **fire-and-forget** (`void`, never `await`): a nurturing failure can
never block or roll back lead creation or a stage update.

### The welcome email
There is no longer a hardcoded welcome email. Instead, every org gets a default
**"Welcome New Leads"** sequence (trigger `lead_created`, one email step, `delayDays 0`),
provisioned automatically on org creation by
`NurturingService.createDefaultWelcomeSequence(orgId)` (called from `AuthService.register`
and `completeProfile`; idempotent — it skips if a `lead_created` sequence already exists).
Because every source fires `lead_created`, any new lead with an email is welcomed within
one engine tick. Admins can edit or disable this sequence from the Nurturing page like
any other.

> Existing orgs created before this change won't have the default sequence. Backfill all
> currently-active orgs (planStatus `ACTIVE`/`TRIAL`) with:
> ```bash
> cd backend
> npm run backfill:welcome          # uses .env
> npm run backfill:welcome:local    # uses .env.local then .env
> ```
> The script (`prisma/backfill-welcome-sequences.ts`) is idempotent — it skips any org
> that already has a `lead_created` sequence, so it's safe to re-run. Expired/cancelled
> orgs are excluded. Alternatively, create the sequence manually from the Nurturing page.

---

## Multi-tenancy & safety

- **Org scoping:** `autoEnroll` only matches sequences in the lead's `orgId`. The tick
  engine acts on each enrollment's own sequence + lead, which already share an org, so
  there is no cross-tenant path.
- **Idempotency:** the unique constraint `(sequenceId, leadId)` guarantees one
  enrollment per lead per sequence; re-enrollment reuses the record.
- **No hard deletes:** un-enrolling sets `status: 'removed'`. Deleting a sequence cascades
  to its steps and enrollments (`onDelete: Cascade`).
- **Graceful degradation:** if a comms provider key is unset, `CommunicationsService`
  logs/records the attempt and skips the external call — the enrollment still advances.

---

## Configuration

Backend `.env` (see `backend/.env.example`):

```
# How often the engine tick advances due enrollments (ms). Default 300000 (5 min).
# Lower it (e.g. 5000) in dev to watch sequences run quickly.
NURTURING_TICK_MS="300000"
```

Requires Redis (already used by the assignment queue) and the relevant comms provider
keys for actual delivery (`SES_FROM_EMAIL`, `TWILIO_*`, `WHATSAPP_*`). Without them,
sequences still advance and record communications; they just don't dispatch externally.

---

## Data model reference

`backend/prisma/schema.prisma`:

```prisma
model NurturingSequence {
  id           String   @id @default(uuid())
  name         String
  description  String?
  triggerEvent String   @default("manual")   // manual | lead_created | stage_change
  triggerStage String?                       // optional LeadStage filter for stage_change
  isActive     Boolean  @default(true)
  orgId        String?
  steps        NurturingStep[]
  enrollments  NurturingEnrollment[]
  // ...
}

model NurturingStep {
  id         String @id @default(uuid())
  sequenceId String
  sequence   NurturingSequence @relation(fields: [sequenceId], references: [id], onDelete: Cascade)
  stepOrder  Int
  type       String            // email | sms | whatsapp | wait
  subject    String?
  body       String?
  delayDays  Int    @default(0)
}

model NurturingEnrollment {
  id          String   @id @default(uuid())
  sequenceId  String
  leadId      String
  status      String   @default("active")    // active | completed | removed
  currentStep Int      @default(0)
  nextRunAt   DateTime?                       // when the current step is due
  enrolledAt  DateTime @default(now())
  completedAt DateTime?

  @@unique([sequenceId, leadId])
  @@index([status, nextRunAt])                // engine query: due active enrollments
}
```

---

## API

All routes are under `/nurturing` and require auth (`JwtAuthGuard`).

| Method & path | Purpose |
|---------------|---------|
| `GET /nurturing/sequences` | List sequences (with step/enrollment counts) |
| `POST /nurturing/sequences` | Create a sequence |
| `GET /nurturing/sequences/:id` | Get a sequence with steps + active enrollments |
| `PATCH /nurturing/sequences/:id` | Update (rename, change trigger, pause via `isActive`) |
| `DELETE /nurturing/sequences/:id` | Delete (cascades to steps + enrollments) |
| `POST /nurturing/sequences/:id/steps` | Add a step |
| `PATCH /nurturing/steps/:stepId` | Update a step |
| `DELETE /nurturing/steps/:stepId` | Delete a step |
| `POST /nurturing/sequences/:id/enroll` | Manually enroll a lead (`{ leadId }`) |
| `DELETE /nurturing/enrollments/:eid` | Remove an enrollment (soft) |

Steps have no auto-reorder — callers assign `stepOrder` explicitly.

---

## Code map

| File | Responsibility |
|------|----------------|
| `backend/src/modules/nurturing/nurturing.service.ts` | All logic: CRUD, `startEnrollment`, `autoEnroll`, `executeDueEnrollments`, `runStep` |
| `backend/src/modules/nurturing/nurturing.processor.ts` | Bull repeatable tick → calls `executeDueEnrollments` |
| `backend/src/modules/nurturing/nurturing.controller.ts` | HTTP endpoints |
| `backend/src/modules/nurturing/nurturing.module.ts` | Wires the queue + `CommunicationsModule` |
| `backend/src/modules/leads/leads.service.ts` | Fires `autoEnroll` on lead create / stage change |
| `frontend/src/pages/Nurturing.tsx` | Sequence builder + enrollment UI |

---

## Testing it end-to-end

**Unit tests** (`backend/src/modules/nurturing/nurturing.service.spec.ts`) cover step
dispatch per channel, step advancement, `nextRunAt` scheduling, completion, `wait` steps,
auto-enroll matching/skipping, and the due-query shape.

```bash
cd backend
npx jest --runInBand src/modules/nurturing/nurturing.service.spec.ts
```

> Run nurturing/leads specs individually — the full backend suite can OOM if run at once.

**Manual end-to-end:**
1. Start infra and the backend: `docker compose up -d` then `npm run dev`.
2. Set `NURTURING_TICK_MS=5000` in `backend/.env.local` so steps fire within seconds.
3. In the UI (Nurturing page): create a sequence (trigger `manual`), add two steps
   (`email` delayDays 0, `sms` delayDays 0), then enroll a lead.
4. Within ~10s confirm (via `npm run db:studio:local`) that two `Communication` rows
   exist for the lead, the enrollment's `currentStep` reached 2, and `status` is
   `completed`.
5. To test triggers: create a sequence with trigger `lead_created`, then create a new
   lead and confirm it auto-enrolls; change a lead's stage and confirm a `stage_change`
   sequence enrolls it.
