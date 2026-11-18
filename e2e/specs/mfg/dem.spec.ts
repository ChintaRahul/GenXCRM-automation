// e2e/specs/mfg/dem.spec.ts - DEM module (TC-DEM-001..008): request, status flow, failure rule, customer decision, hand-off prompt, sample logistics.
import { expect, test, type Page } from "@playwright/test";
import { authFile } from "../../fixtures/mfgUsers";
import { ModuleDetail } from "../../pages/mfg/ModuleDetail";
import { ModuleDrawer } from "../../pages/mfg/ModuleDrawer";
import { ModuleList } from "../../pages/mfg/ModuleList";
import { apiAs, ApiClient, build, ok, type ApiResult } from "../../mfg/api";
import { tc } from "../../mfg/caseTest";
import { expectActionRejected, knownDefect } from "../../mfg/guards";
import { uniqueTag } from "../../mfg/tag";

type Rec = Record<string, unknown>;
type Sla = { l: string; t: string } | null;

const rec = (r: ApiResult, what: string): Rec => ok(r, what).body as Rec;
const evalOf = async (api: ApiClient, id: string): Promise<Rec> => rec(await api.get(`/modules/demos/${id}`), "read evaluation");
const idsOf = (r: ApiResult): string[] => (r.body.data ?? []).map((a) => a.id as string);
const idFromUrl = (page: Page): string => page.url().split("/").at(-1) ?? "";
const dateInput = (days: number): string => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const DETAIL_RE = /\/demos\/[0-9a-f-]{36}$/;

/**
 * Account + opportunity (salesExec1) + a Requested evaluation owned by `owner`. Evaluations are own-record scoped (see D-47): the
 * Application Engineer can only work on evaluations he owns, so the engineer's cases create them as appEngineer.
 */
const newEvaluation = async (over: Rec = {}, oppOver: Rec = {}, owner: "salesExec1" | "appEngineer" = "salesExec1") => {
  const sales = await apiAs("salesExec1");
  const api = await apiAs(owner);
  const account = await build.account(sales);
  const opp = await build.opportunity(sales, account.id, oppOver);
  const evaluation = await build.evaluation(api, { opportunityId: opp.id, accountId: account.id }, over);
  return { sales, api, account, opp, ...evaluation };
};
/** Drives an evaluation to `target` through the real actions, as `api` (its owner). */
const advanceTo = async (api: ApiClient, id: string, target: "Scheduled" | "In progress" | "Successful"): Promise<void> => {
  const steps = { Scheduled: ["Schedule"], "In progress": ["Schedule", "Start"], Successful: ["Schedule", "Start", "Mark successful"] }[target];
  for (const action of steps) ok(await api.action("demos", id, action), action);
};
const openEvaluation = async (page: Page, id: string): Promise<ModuleDetail> => {
  const detail = new ModuleDetail(page);
  await detail.goto("demos", id);
  await expect(page.getByTestId("status-badge")).toBeVisible();
  return detail;
};

test.describe("DEM - Sales Executive", () => {
  test.use({ storageState: authFile("salesExec1") });

  tc("TC-DEM-001", async ({ page }) => {
    test.slow(); // cold stack
    const api = await apiAs("salesExec1");
    const account = await build.account(api);
    const opp = await build.opportunity(api, account.id);
    const title = `${uniqueTag("D1")} weighbridge demo`;
    const list = new ModuleList(page, "demos");
    const drawer = new ModuleDrawer(page);
    await list.goto();
    await list.clickNew();
    // Opportunity / Account are raw-UUID text boxes (D-31 pattern). Sample qty (number) is left empty: number fields are posted as strings (D-6).
    await drawer.fill({ title, type: "Trial", opportunityId: opp.id, accountId: account.id, product: "60 T weighbridge", plannedDate: dateInput(5) });
    await drawer.save();
    await page.waitForURL(DETAIL_RE);
    const id = idFromUrl(page);
    const detail = new ModuleDetail(page);
    await detail.expectAction("Schedule");
    expect(await detail.statusText()).toBe("Requested");
    const evaluation = await evalOf(api, id);
    expect(evaluation).toMatchObject({ title, type: "Trial", opportunityId: opp.id, accountId: account.id, product: "60 T weighbridge", status: "Requested" });
    expect((evaluation.plannedDate as string).slice(0, 10)).toBe(dateInput(5));
    await list.goto();
    await list.search(title);
    await expect(list.row(title)).toBeVisible();
    // listed on the opportunity's "Demos & trials" tab
    expect(idsOf(await api.get(`/modules/opps/${opp.id}/related/demos`))).toEqual([id]);
  });

  tc("TC-DEM-005", async ({ page }) => {
    // Customer approved: only from Successful
    const approved = await newEvaluation();
    await expectActionRejected(approved.sales, "demos", approved.id, "Customer approved", {}, "Cannot Customer approved an evaluation in status 'Requested'.");
    await advanceTo(approved.sales, approved.id, "In progress");
    await expectActionRejected(approved.sales, "demos", approved.id, "Customer approved", {}, "Cannot Customer approved an evaluation in status 'In progress'.");
    ok(await approved.sales.action("demos", approved.id, "Mark successful"), "mark successful");
    const detail = await openEvaluation(page, approved.id);
    expect(await detail.statusText()).toBe("Successful");
    await detail.action("Customer approved");
    await expect.poll(() => detail.statusText()).toBe("Customer approved");
    expect((await evalOf(approved.sales, approved.id)).status).toBe("Customer approved");
    await page.reload();
    await expect(page.getByTestId("status-badge")).toHaveText("Customer approved");
    await detail.expectNoAction("Customer approved");
    await detail.expectNoAction("Customer rejected");

    // Customer rejected (separate case): from Successful, not from Requested
    const rejected = await newEvaluation();
    // allowed from Successful/Completed only (evaluations.service); no action leads to 'Completed', so it is not reachable here
    await expectActionRejected(rejected.sales, "demos", rejected.id, "Customer rejected", {}, "Cannot Customer rejected an evaluation in status 'Requested'.");
    await advanceTo(rejected.sales, rejected.id, "In progress");
    await expectActionRejected(rejected.sales, "demos", rejected.id, "Customer rejected", {}, "Cannot Customer rejected an evaluation in status 'In progress'.");
    ok(await rejected.sales.action("demos", rejected.id, "Mark successful"), "mark successful");
    await openEvaluation(page, rejected.id);
    await detail.action("Customer rejected");
    await expect.poll(() => detail.statusText()).toBe("Customer rejected");
    expect((await evalOf(rejected.sales, rejected.id)).status).toBe("Customer rejected");
    // a rejected evaluation cannot be approved afterwards
    await expectActionRejected(rejected.sales, "demos", rejected.id, "Customer approved", {}, "Cannot Customer approved an evaluation in status 'Customer rejected'.");
  });

  tc("TC-DEM-006", async ({ page }) => {
    // Partial case. Spec: after a successful trial the user is prompted (or can easily move) the opportunity to 'Solution proposed' (40%).
    // Current behaviour: no prompt exists anywhere; the stage move is the manual Advance stage action on the opportunity.
    const { sales, opp, id } = await newEvaluation({}, { stage: "Demo / trial" });
    await advanceTo(sales, id, "Successful");
    const detail = await openEvaluation(page, id);
    expect(await detail.statusText()).toBe("Successful");
    await detail.action("Customer approved");
    await expect.poll(() => detail.statusText()).toBe("Customer approved");
    await knownDefect(test.info(), "D-46", async () => {
      await expect(page.getByText(/Solution proposed/), "a prompt to move the opportunity to Solution proposed").toBeVisible({ timeout: 1_500 });
    });
    // the opportunity is still at 'Demo / trial' (nothing moved it) ...
    expect((rec(await sales.get(`/modules/opps/${opp.id}`), "read opportunity")).stage).toBe("Demo / trial");
    // ... and can be moved by hand: Advance stage targets 'Solution proposed' from there
    const oppDetail = new ModuleDetail(page);
    await oppDetail.goto("opps", opp.id);
    await oppDetail.action("Advance stage");
    await expect(page.getByRole("dialog").getByText("Solution proposed")).toBeVisible();
    await page.locator("#advance-next-action").fill("Prepare the proposal");
    await page.locator("#advance-next-action-date").fill(dateInput(4));
    await page.getByRole("dialog").getByRole("button", { name: "Advance", exact: true }).click();
    await expect.poll(async () => (rec(await sales.get(`/modules/opps/${opp.id}`), "read opportunity")).stage).toBe("Solution proposed");
  });
});

test.describe("DEM - Application Engineer", () => {
  test.use({ storageState: authFile("appEngineer") });

  tc("TC-DEM-002", async ({ page }) => {
    // Spec §11: the Application Engineer runs demos/trials that sales requested. Evaluations are own-record scoped, so an evaluation
    // requested by a Sales Executive is a 404 for the engineer (the engineer's own evaluation below is used for the flow).
    const requested = await newEvaluation();
    const engineerRead = await (await apiAs("appEngineer")).get(`/modules/demos/${requested.id}`);
    await knownDefect(test.info(), "D-47", async () => {
      expect(engineerRead.status, "engineer reads a sales-requested evaluation").toBe(200);
    });
    // defect evidence: exactly 404 (not a 403/500), only checked while the defect is present
    if (engineerRead.status !== 200) expect(engineerRead.status, ApiClient.message(engineerRead)).toBe(404);
    const { api, id } = await newEvaluation({}, {}, "appEngineer");
    const detail = await openEvaluation(page, id);
    expect(await detail.statusText()).toBe("Requested");
    expect((await evalOf(api, id)).sla, "SLA-09 has not started yet").toBeNull();
    await detail.action("Schedule");
    await expect.poll(() => detail.statusText()).toBe("Scheduled");
    expect((await evalOf(api, id)).status).toBe("Scheduled");
    expect((await evalOf(api, id)).sla, "SLA-09 starts at Start, not at Schedule").toBeNull();
    await detail.action("Start");
    await expect.poll(() => detail.statusText()).toBe("In progress");
    const started = await evalOf(api, id);
    expect(started.status).toBe("In progress");
    expect(started.sla, "SLA-09 timer exists after Start").not.toBeNull();
    expect((started.sla as Sla)?.l).not.toBe("Met");
    await detail.action("Mark successful");
    await expect.poll(() => detail.statusText()).toBe("Successful");
    const done = await evalOf(api, id);
    expect(done.status).toBe("Successful");
    expect(done.sla, "SLA-09 stops when the result is recorded").toMatchObject({ l: "Met" });
  });

  tc("TC-DEM-003", async ({ page }) => {
    const { api, id } = await newEvaluation({}, {}, "appEngineer");
    const detail = await openEvaluation(page, id);
    await detail.expectAction("Schedule");
    await detail.expectNoAction("Start"); // the UI does not offer Start before Schedule
    await expectActionRejected(api, "demos", id, "Start", {}, "Cannot Start an evaluation in status 'Requested'.");
    expect((await evalOf(api, id)).status).toBe("Requested");
    expect((await evalOf(api, id)).sla, "no SLA-09 timer was started").toBeNull();
    await page.reload();
    await detail.expectAction("Schedule");
    expect(await detail.statusText()).toBe("Requested");
  });

  tc("TC-DEM-004", async ({ page }) => {
    const { api, id } = await newEvaluation({}, {}, "appEngineer");
    await advanceTo(api, id, "In progress");
    const detail = await openEvaluation(page, id);
    expect(await detail.statusText()).toBe("In progress");
    // empty result: the dialog blocks it, the server rejects it
    await detail.action("Mark failed");
    await expect(page.locator("#action-ask-field")).toHaveValue("");
    await expect(page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true })).toBeDisabled();
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
    const message = "'result' is required to Mark failed.";
    await expectActionRejected(api, "demos", id, "Mark failed", {}, message);
    await expectActionRejected(api, "demos", id, "Mark failed", { result: "" }, message);
    expect((await evalOf(api, id)).status).toBe("In progress");
    // with a result
    const result = `${uniqueTag("RES")} load cell drifted under vibration`;
    await detail.action("Mark failed");
    await detail.answerPrompt(result);
    await expect.poll(() => detail.statusText()).toBe("Failed");
    const failed = await evalOf(api, id);
    expect(failed).toMatchObject({ status: "Failed", result });
    expect(failed.sla, "SLA-09 stops when the result is recorded").toMatchObject({ l: "Met" });
    // the result shows on the Parameters & result tab
    await detail.tab("Parameters & result");
    await expect(page.getByText(result)).toBeVisible();
  });

  tc("TC-DEM-007", async ({ page }) => {
    const { api, id } = await newEvaluation({ type: "Sample", product: "Load cell sample" }, {}, "appEngineer");
    const detail = await openEvaluation(page, id);
    await detail.tab("Sample logistics");
    // nothing set yet: every logistics date shows the empty marker (positive signal: the fields rendered)
    await expect(page.locator("p:text-is('Sample dispatched') + p")).toHaveText("—");
    const dates = { sampleDispatched: dateInput(1), sampleDelivered: dateInput(3), sampleTested: dateInput(5) };
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Edit Evaluation" })).toBeVisible();
    const drawer = new ModuleDrawer(page);
    await drawer.fill(dates);
    const patched = page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().endsWith(`/modules/demos/${id}`));
    await drawer.save();
    const patchResponse = await patched;
    const patchStatus = patchResponse.status();
    const patchBody = await patchResponse.text();
    // Spec: the dates are saved from the form. The edit drawer PATCHes the whole record (id, orgId, status, isDeleted, createdAt, updatedAt, sla)
    // and the API rejects those properties with 400, so the Sample logistics dates cannot be saved from the UI.
    expect(patchStatus, "edit drawer save").toBe(200);
    if (patchStatus !== 200) {
      // defect evidence: exactly 400 from the DTO whitelist, naming the non-whitelisted record properties
      expect(patchStatus, patchBody).toBe(400);
      expect(patchBody).toContain("property id should not exist");
      test.info().annotations.push({ type: "d-48-response", description: patchBody.slice(0, 300) });
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      ok(await api.patch(`/modules/demos/${id}`, dates), "save the logistics dates through the API instead");
    }
    const saved = await evalOf(api, id);
    for (const [key, day] of Object.entries(dates)) expect((saved[key] as string).slice(0, 10), key).toBe(day);
    // shown on the Sample logistics tab
    await page.reload();
    await expect(page.getByTestId("status-badge")).toBeVisible();
    await detail.tab("Sample logistics");
    const labels = { sampleDispatched: "Sample dispatched", sampleDelivered: "Sample delivered", sampleTested: "Sample tested" };
    for (const label of Object.values(labels)) await expect(page.locator(`p:text-is('${label}') + p`), label).not.toHaveText("—"); // a value is shown
    // The tab prints the raw ISO timestamp ("2026-10-04T00:00:00.000Z") instead of a formatted date like the list columns do (D-49).
    const shown = (iso: string): Promise<string> => page.evaluate((v) => new Date(v).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }), iso);
    await expect(page.locator("p:text-is('Sample dispatched') + p")).toHaveText(await shown(saved.sampleDispatched as string), { timeout: 1_000 });
  });

  tc("TC-DEM-008", async () => {});
});
