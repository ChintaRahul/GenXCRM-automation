// e2e/specs/mfg/eng.spec.ts - Engage: nurturing sequences and templates (TC-ENG-001..007).
// The Manufacturing workspace has no module adapters for 'nurturing' / 'templates' (GET /modules/nurturing answers 404 'Module ... is not available');
// the sidebar links open the generic EdTech pages /nurturing and /templates, backed by /nurturing/* and /templates. Sequences enrol rows of the EdTech
// `Lead` model, not Manufacturing leads (D-108), so the enrolment cases are asserted on both. Every sequence is deleted again; steps start with a 30-day
// wait so that no email / WhatsApp is ever sent by an enrolment of this suite, and no WhatsApp template is created (that would reach the real Meta account).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { authFile } from "../../fixtures/mfgUsers";
import { ModuleDetail } from "../../pages/mfg/ModuleDetail";
import { API, apiAs, ApiClient, build, ok, type ApiResult } from "../../mfg/api";
import { tc } from "../../mfg/caseTest";
import { knownDefect } from "../../mfg/guards";
import { uniquePhone, uniqueTag } from "../../mfg/tag";

type Rec = Record<string, unknown>;

const rec = (r: ApiResult, what: string): Rec => ok(r, what).body as Rec;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const sequences: string[] = [];
const templates: string[] = [];
const leads: string[] = [];

const remove = async (api: ApiClient, path: string): Promise<void> => {
  try {
    const res = await fetch(`${API}${path}`, { method: "DELETE", headers: { authorization: `Bearer ${api.token}` } });
    if (!res.ok && res.status !== 404) test.info().annotations.push({ type: "cleanup-failed", description: `DELETE ${path} -> HTTP ${res.status}` });
  } catch (e: unknown) {
    test.info().annotations.push({ type: "cleanup-failed", description: `DELETE ${path}: ${e instanceof Error ? e.message : String(e)}` });
  }
};
/** Sequence created through the API by the Sales Head; tracked for deletion. */
const newSequence = async (over: Rec = {}): Promise<string> => {
  const sh = await apiAs("salesHead");
  const id = rec(await sh.post("/nurturing/sequences", { name: uniqueTag("SEQ"), triggerEvent: "manual", ...over }), "create sequence").id as string;
  sequences.push(id);
  return id;
};
/** A 30-day wait: an enrolment into it never reaches a sending step. */
const addWait = async (sequenceId: string, stepOrder = 1): Promise<void> => {
  ok(await (await apiAs("salesHead")).post(`/nurturing/sequences/${sequenceId}/steps`, { type: "wait", stepOrder, delayDays: 30 }), "add wait step");
};
const activate = async (sequenceId: string): Promise<void> => {
  ok(await (await apiAs("salesHead")).patch(`/nurturing/sequences/${sequenceId}`, { isActive: true }), "activate sequence");
};
const enrollmentsOf = async (sequenceId: string): Promise<Rec[]> => {
  const r = ok(await (await apiAs("salesHead")).get(`/nurturing/sequences/${sequenceId}/enrollments?limit=100`), "enrollments");
  return r.body.data ?? [];
};
/** Rows of the EdTech `Lead` model (note: POST /leads can auto-enrol the new lead into ACTIVE lead_created sequences of the org; deleted again in afterAll) (the only thing sequences can enrol); created through POST /leads, which accepts them in any workspace. */
const newEdtechLead = async (): Promise<string> => {
  const sh = await apiAs("salesHead");
  const id = rec(await sh.post("/leads", { name: `${uniqueTag("ENGL")} Lead`, phone: uniquePhone(), source: "OTHER" }), "create EdTech-model lead").id as string;
  leads.push(id);
  return id;
};
/** Trigger events that any backend code passes to NurturingService.autoEnroll (source scan, drift guard for TC-ENG-003). */
const autoEnrollTriggers = (): string[] => {
  const found = new Set<string>();
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (full.endsWith(".ts") && !full.endsWith(".spec.ts")) {
        for (const m of readFileSync(full, "utf8").matchAll(/autoEnroll\(\s*[^,()]+,\s*[^,()]+,\s*'([a-z_]+)'/g)) found.add(m[1] as string);
      }
    }
  };
  walk(resolve(__dirname, "../../../backend/src"));
  return [...found].sort();
};

test.afterAll(async () => {
  const sh = await apiAs("salesHead");
  for (const id of sequences) await remove(sh, `/nurturing/sequences/${id}`);
  for (const id of templates) await remove(sh, `/templates/${id}`);
  for (const id of leads) await remove(sh, `/leads/${id}`);
});

test.describe("Engage - Sales Head", () => {
  test.use({ storageState: authFile("salesHead") });

  tc("TC-ENG-001", async ({ page }) => {
    const sh = await apiAs("salesHead");
    const name = `${uniqueTag("ENG1")} AMC welcome`;
    // Nurturing -> New sequence: the dialog offers the triggers the generic page has; the AMC / Nurture triggers of the spec are not among them (D-108)
    await page.goto("/nurturing");
    await page.getByRole("button", { name: "New Sequence" }).first().click();
    const dialog = page.getByRole("dialog", { name: "New Nurturing Sequence" });
    await dialog.getByPlaceholder("e.g. MBA Welcome Sequence").fill(name);
    await dialog.getByRole("combobox").click();
    await expect(page.getByRole("option", { name: "Manual enrollment" })).toBeVisible();
    const offered = await page.getByRole("option").allInnerTexts();
    expect(offered).toEqual(expect.arrayContaining(["Manual enrollment", "When lead is created", "When stage changes"]));
    await knownDefect(test.info(), "D-108", async () => {
      expect(offered.join("|"), "trigger options").toMatch(/Nurture|AMC|Quotation/i);
    });
    await page.getByRole("option", { name: "Manual enrollment" }).click();
    await dialog.getByRole("button", { name: "Create" }).click();
    // the sequence exists (Draft / inactive) and the page shows it
    let id = "";
    await expect.poll(async () => {
      const list = ok(await sh.get("/nurturing/sequences"), "sequences").body as unknown as Rec[] | { data: Rec[] };
      id = ((Array.isArray(list) ? list : list.data).find((s) => s.name === name)?.id as string | undefined) ?? "";
      return id;
    }, { message: "sequence saved from the dialog" }).not.toBe("");
    sequences.push(id);
    expect(await (async () => (rec(await sh.get(`/nurturing/sequences/${id}`), "read sequence")))()).toMatchObject({ name, triggerEvent: "manual", isActive: false });
    // steps are added by the caller with an explicit stepOrder (added out of order on purpose); the API returns them ordered by stepOrder
    ok(await sh.post(`/nurturing/sequences/${id}/steps`, { type: "email", stepOrder: 30, subject: "Renewal offer", body: "Hi {{name}}, your AMC ends soon.", delayDays: 5 }), "step 30");
    ok(await sh.post(`/nurturing/sequences/${id}/steps`, { type: "email", stepOrder: 10, subject: "Welcome", body: "Welcome aboard.", delayDays: 0 }), "step 10");
    ok(await sh.post(`/nurturing/sequences/${id}/steps`, { type: "wait", stepOrder: 20, delayDays: 2 }), "step 20");
    const saved = rec(await sh.get(`/nurturing/sequences/${id}`), "read sequence");
    const steps = saved.steps as Rec[];
    expect(steps.map((s) => [s.stepOrder, s.type, s.delayDays])).toEqual([[10, "email", 0], [20, "wait", 2], [30, "email", 5]]);
    // UI: open the sequence, see its steps in order, activate it
    await page.goto("/nurturing");
    await page.getByText(name).click();
    const stepCards = page.locator("p.text-sm.font-medium").filter({ hasText: /^(Email|Wait)/ });
    await expect(stepCards).toHaveCount(3);
    await expect(stepCards.nth(0)).toHaveText(/^Email$/);
    await expect(stepCards.nth(1)).toContainText("Wait");
    await expect(stepCards.nth(1)).toContainText("after 2d");
    await expect(stepCards.nth(2)).toContainText("after 5d");
    await page.getByRole("button", { name: "Activate", exact: true }).click();
    await expect.poll(async () => (await rec(await sh.get(`/nurturing/sequences/${id}`), "read sequence")).isActive, { message: "sequence active after Activate" }).toBe(true);
    await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
    // The Manufacturing 'Nurturing' module page (registry) has no backend module: the module API answers 404
    const registry = await sh.get("/modules/nurturing");
    expect([registry.status, ApiClient.message(registry)]).toEqual([404, "Module 'nurturing' is not available."]);
  });

  tc("TC-ENG-003", async () => {
    // Spec: Lead created, Quotation sent, Opportunity lost (postponed) and AMC renewal triggers enrol the record. Fire the events we can and read what the code wires.
    const triggers = { lead: "lead_created", quotation: "quotation_sent", opportunity: "opportunity_lost_postponed", amc: "amc_90_days" };
    const seqs: Record<string, string> = {};
    for (const [key, trigger] of Object.entries(triggers)) {
      seqs[key] = await newSequence({ triggerEvent: trigger });
      await addWait(seqs[key] as string);
      await activate(seqs[key] as string);
    }
    // events: a Manufacturing lead is created and a quotation is sent
    const sales = await apiAs("salesExec1");
    const lead = await build.lead(sales);
    const account = await build.account(sales);
    const opp = await build.opportunity(sales, account.id);
    const product = await build.product(await apiAs("commercial"));
    const quote = await build.sentQuotation(sales, { opportunityId: opp.id, accountId: account.id, productId: product.id });
    const sent = rec(await sales.get(`/modules/quotes/${quote.id}`), "read quotation");
    if (sent.status !== "Sent") throw new Error(`precondition: quotation is '${String(sent.status)}', not Sent`);
    if (!lead.id) throw new Error("precondition: lead not created");
    await sleep(4_000); // let any asynchronous trigger run (enrolment fires without delay for a first step of delay 0; ours waits)
    const totals = await Promise.all(Object.values(seqs).map(async (id) => (await enrollmentsOf(id)).length));
    // the code wires only the EdTech lead flows: 'lead_created' and 'stage_change' (no call site for the other triggers)
    expect(autoEnrollTriggers(), "trigger events passed to autoEnroll anywhere in the backend").toEqual(["lead_created", "stage_change"]);
    // current: nothing is enrolled by any of the four triggers for Manufacturing records
    if (totals.some((n) => n !== 1)) expect(totals, "current: no sequence enrolled anything (remove with D-108)").toEqual([0, 0, 0, 0]);
    await knownDefect(test.info(), "D-108", async () => {
      expect(totals, "enrolments of the lead-created, quotation-sent, opportunity-lost and AMC sequences").toEqual([1, 1, 1, 1]);
    });
  });

  tc("TC-ENG-005", async ({ page }) => {
    const sh = await apiAs("salesHead");
    const name = `${uniqueTag("TPL")} welcome mail`;
    // Email templates are saved without any approval state (status null); only WhatsApp templates have a status, driven by Meta. No WhatsApp template is
    // created here: that would be submitted to the real Meta account.
    const created = rec(await sh.post("/templates", { channel: "EMAIL", name, subject: "Welcome", body: "Hello {{name}}" }), "create email template");
    templates.push(created.id as string);
    expect(created).toMatchObject({ channel: "EMAIL", name, isSystem: false });
    // submit-for-approval exists only for WhatsApp
    const submit = await sh.post(`/templates/${created.id as string}/submit`);
    expect([submit.status, ApiClient.message(submit)]).toEqual([400, "Only WhatsApp templates can be submitted for approval."]);
    // there is no approve / reject: a status sent by the Sales Head is ignored
    const patched = await sh.patch(`/templates/${created.id as string}`, { status: "APPROVED" });
    const after = rec(await sh.get(`/templates/${created.id as string}`), "read template");
    expect(patched.status, "PATCH with a status is accepted and ignored").toBe(200);
    expect(after.status, "the template status after an approval attempt").toBeNull();
    // Spec: Draft -> Pending approval -> Approved / Rejected by the Sales Head; email templates carry a status and need approval
    await knownDefect(test.info(), "D-109", async () => {
      expect(after.status, "email template status after Approve").toBe("APPROVED");
    });
    // enforced: a WhatsApp sequence step must use an APPROVED template (an unknown / unapproved one is refused with the exact message)
    const sequenceId = await newSequence();
    const step = await sh.post(`/nurturing/sequences/${sequenceId}/steps`, { type: "whatsapp", stepOrder: 1, templateName: `unapproved_${uniqueTag("T").toLowerCase().replace(/-/g, "_")}`, templateLang: "en_US" });
    expect([step.status, ApiClient.message(step)]).toEqual([400, "WhatsApp nurturing steps must use an approved template. Submit and get the template approved first."]);
    // the Sales Executive can read templates but not create them (templates: R)
    const exec = await apiAs("salesExec1");
    expect((await exec.get("/templates")).status).toBe(200);
    expect((await exec.post("/templates", { channel: "EMAIL", name: "x", subject: "s", body: "b" })).status).toBe(403);
    // UI: the Templates page lists the template
    await page.goto("/templates");
    await expect(page.getByText(name)).toBeVisible();
  });
});

test.describe("Engage - Sales Executive", () => {
  test.use({ storageState: authFile("salesExec1") });

  tc("TC-ENG-002", async ({ page }) => {
    const seq = await newSequence({ triggerEvent: "lead_moved_to_nurture" });
    await addWait(seq);
    await activate(seq);
    const sales = await apiAs("salesExec1");
    const lead = await build.lead(sales);
    ok(await sales.action("leads", lead.id, "Mark contacted"), "mark contacted");
    // Move a lead to Nurture in the UI
    const detail = new ModuleDetail(page);
    await detail.goto("leads", lead.id);
    await detail.action("Move to nurture");
    await expect.poll(async () => (await rec(await sales.get(`/modules/leads/${lead.id}`), "read lead")).status, { message: "lead status after Move to nurture" }).toBe("Nurture");
    await sleep(4_000); // an enrolment would be created synchronously by the trigger; allow for async dispatch
    const enrolled = (await enrollmentsOf(seq)).length;
    // current: the Manufacturing lead flow never calls the nurturing service, and sequences only know EdTech leads
    if (enrolled !== 1) expect(enrolled, "current: the lead is not enrolled (remove with D-108)").toBe(0);
    await knownDefect(test.info(), "D-108", async () => {
      expect(enrolled, "enrolments of the 'Lead moved to Nurture' sequence").toBe(1);
    });
    // manual enrolment of the Manufacturing lead is refused as well: the id is not a row of the EdTech Lead model
    const manual = await (await apiAs("salesHead")).post(`/nurturing/sequences/${seq}/enroll`, { leadId: lead.id });
    expect([manual.status, ApiClient.message(manual)], "enrolling a Manufacturing lead").toEqual([404, "This lead could not be found."]);
  });

  tc("TC-ENG-004", async () => {
    const seq = await newSequence();
    await addWait(seq);
    await activate(seq);
    const sh = await apiAs("salesHead");
    // the enrolment rules, on the only kind of lead sequences can enrol (EdTech-model lead)
    const lead = await newEdtechLead();
    const first = rec(await sh.post(`/nurturing/sequences/${seq}/enroll`, { leadId: lead }), "enrol");
    expect(first).toMatchObject({ sequenceId: seq, leadId: lead, status: "active", currentStep: 0 });
    // enrolling again while active: conflict
    const again = await sh.post(`/nurturing/sequences/${seq}/enroll`, { leadId: lead });
    expect([again.status, ApiClient.message(again)]).toEqual([409, "This lead is already enrolled in this sequence."]);
    expect((await enrollmentsOf(seq)).map((e) => e.id), "still one enrolment").toEqual([first.id]);
    // remove the enrolment (soft delete: the row stays with status removed, the list hides it), then enrol again: the same enrolment is re-activated from step 0
    const removed = await fetch(`${API}/nurturing/enrollments/${first.id as string}`, { method: "DELETE", headers: { authorization: `Bearer ${sh.token}` } });
    expect(removed.status).toBe(204);
    expect(await enrollmentsOf(seq), "a removed enrolment is no longer listed").toEqual([]);
    const re = rec(await sh.post(`/nurturing/sequences/${seq}/enroll`, { leadId: lead }), "re-enrol");
    expect(re).toMatchObject({ id: first.id, status: "active", currentStep: 0 });
    expect(Date.parse(re.enrolledAt as string), "enrolledAt reset on re-activation").toBeGreaterThanOrEqual(Date.parse(first.enrolledAt as string));
    // Spec: the Sales Executive does this on a (Manufacturing) lead; the enrol endpoint only accepts EdTech-model leads (D-108)
    const sales = await apiAs("salesExec1");
    const mfgLead = await build.lead(sales);
    const mine = await sales.post(`/nurturing/sequences/${seq}/enroll`, { leadId: mfgLead.id });
    if (mine.status !== 201) expect([mine.status, ApiClient.message(mine)], "current: a Manufacturing lead cannot be enrolled (remove with D-108)").toEqual([404, "This lead could not be found."]);
    await knownDefect(test.info(), "D-108", async () => {
      expect(mine.status, "Sales Executive enrols a Manufacturing lead").toBe(201);
    });
  });
});

// TC-ENG-006 / TC-ENG-007: external delivery (email / WhatsApp) - skipped by the case wrapper.
tc("TC-ENG-006", async () => {});
tc("TC-ENG-007", async () => {});
