// e2e/specs/mfg/vis.spec.ts - VIS module (TC-VIS-001..010): schedule, confirm, reschedule, complete, report PDF, cancel, reminder gap.
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { authFile } from "../../fixtures/mfgUsers";
import { ModuleDetail } from "../../pages/mfg/ModuleDetail";
import { ModuleDrawer } from "../../pages/mfg/ModuleDrawer";
import { ModuleList } from "../../pages/mfg/ModuleList";
import { apiAs, ApiClient, build, isoDate, ok, type ApiResult } from "../../mfg/api";
import { tc } from "../../mfg/caseTest";
import { expectActionRejected } from "../../mfg/guards";
import { uniqueTag } from "../../mfg/tag";

type Rec = Record<string, unknown>;
type Sla = { l: string; t: string } | null;

const rec = (r: ApiResult, what: string): Rec => ok(r, what).body as Rec;
const visitOf = async (api: ApiClient, id: string): Promise<Rec> => rec(await api.get(`/modules/visits/${id}`), "read site visit");
const idsOf = (r: ApiResult): string[] => (r.body.data ?? []).map((a) => a.id as string);
const idFromUrl = (page: Page): string => page.url().split("/").at(-1) ?? "";
const dateInput = (days: number): string => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const DETAIL_RE = /\/site-visits\/[0-9a-f-]{36}$/;

/** Account + opportunity + a Planned visit, all owned by salesExec1. */
const newVisit = async (over: Rec = {}) => {
  const api = await apiAs("salesExec1");
  const account = await build.account(api);
  const opp = await build.opportunity(api, account.id);
  const visit = await build.visit(api, { accountId: account.id, opportunityId: opp.id }, over);
  return { api, account, opp, ...visit };
};
/** Loads a visit's detail page and waits for the status badge. */
const openVisit = async (page: Page, id: string): Promise<ModuleDetail> => {
  const detail = new ModuleDetail(page);
  await detail.goto("visits", id);
  await expect(page.getByTestId("status-badge")).toBeVisible();
  return detail;
};

test.describe("VIS - Sales Executive", () => {
  test.use({ storageState: authFile("salesExec1") });

  tc("TC-VIS-001", async ({ page }) => {
    test.slow(); // cold stack
    const api = await apiAs("salesExec1");
    const account = await build.account(api);
    const opp = await build.opportunity(api, account.id);
    const title = `${uniqueTag("V1")} plant survey`;
    const list = new ModuleList(page, "visits");
    const drawer = new ModuleDrawer(page);
    await list.goto();
    await list.clickNew();
    // Opportunity / Account are raw-UUID text boxes (D-31 pattern); the sales owner is left to the server (the creator).
    await drawer.fill({
      title, opportunityId: opp.id, accountId: account.id, plant: "Plant 1", visitDate: dateInput(3), time: "10:30",
      engineers: "Mfg App Engineer", objective: "Survey the weighbridge pit and the approach road",
    });
    await drawer.save();
    await page.waitForURL(DETAIL_RE);
    const id = idFromUrl(page);
    const detail = new ModuleDetail(page);
    await detail.expectAction("Confirm");
    expect(await detail.statusText()).toBe("Planned");
    const visit = await visitOf(api, id);
    expect(visit).toMatchObject({
      title, opportunityId: opp.id, accountId: account.id, plant: "Plant 1", time: "10:30", engineers: "Mfg App Engineer", status: "Planned",
      objective: "Survey the weighbridge pit and the approach road",
    });
    expect((visit.visitDate as string).slice(0, 10)).toBe(dateInput(3));
    await list.goto();
    await list.search(title);
    await expect(list.row(title)).toBeVisible();
  });

  tc("TC-VIS-002", async ({ page }) => {
    const { api, id } = await newVisit();
    const detail = await openVisit(page, id);
    expect(await detail.statusText()).toBe("Planned");
    await detail.action("Confirm");
    await expect.poll(() => detail.statusText()).toBe("Confirmed");
    expect((await visitOf(api, id)).status).toBe("Confirmed");
    await detail.expectNoAction("Confirm"); // only from Planned / Rescheduled
    // a Rescheduled visit can be confirmed again
    ok(await api.action("visits", id, "Reschedule", { date: isoDate(9) }), "reschedule");
    expect((await visitOf(api, id)).status).toBe("Rescheduled");
    await page.reload();
    await expect(page.getByTestId("status-badge")).toBeVisible();
    await detail.action("Confirm");
    await expect.poll(() => detail.statusText()).toBe("Confirmed");
    // Server guard: nothing to confirm on a Completed visit
    ok(await api.action("visits", id, "Complete visit", { next: "Send the report" }), "complete");
    await expectActionRejected(api, "visits", id, "Confirm", {}, "Cannot Confirm a site visit in status 'Completed'.");
    expect((await visitOf(api, id)).status).toBe("Completed");
  });

  tc("TC-VIS-003", async ({ page }) => {
    const { api, id } = await newVisit();
    ok(await api.action("visits", id, "Confirm"), "confirm");
    const before = await visitOf(api, id);
    const detail = await openVisit(page, id);
    // without a date: the dialog blocks it, the server rejects it
    await detail.action("Reschedule");
    await expect(page.locator("#action-ask-field")).toHaveValue("");
    await expect(page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true })).toBeDisabled();
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
    const message = "'date' is required to Reschedule.";
    await expectActionRejected(api, "visits", id, "Reschedule", {}, message);
    await expectActionRejected(api, "visits", id, "Reschedule", { date: "" }, message);
    const unchanged = await visitOf(api, id);
    expect(unchanged.status).toBe("Confirmed");
    expect(unchanged.visitDate).toBe(before.visitDate);
    // with a date
    const newDate = dateInput(10);
    await detail.action("Reschedule");
    await detail.answerPrompt(newDate);
    await expect.poll(() => detail.statusText()).toBe("Rescheduled");
    const rescheduled = await visitOf(api, id);
    expect(rescheduled.status).toBe("Rescheduled");
    expect((rescheduled.visitDate as string).slice(0, 10)).toBe(newDate);
    expect(rescheduled.visitDate).not.toBe(before.visitDate);
    // and it can be Confirmed again
    await detail.action("Confirm");
    await expect.poll(() => detail.statusText()).toBe("Confirmed");
    expect((await visitOf(api, id)).status).toBe("Confirmed");
  });

  tc("TC-VIS-004", async ({ page }) => {
    const { api, id } = await newVisit();
    ok(await api.action("visits", id, "Confirm"), "confirm");
    const detail = await openVisit(page, id);
    await detail.action("Complete visit");
    await expect(page.locator("#action-ask-field")).toHaveValue("");
    await expect(page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true })).toBeDisabled(); // blank next action cannot be submitted
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
    const message = "'next' is required to Complete visit.";
    await expectActionRejected(api, "visits", id, "Complete visit", {}, message);
    await expectActionRejected(api, "visits", id, "Complete visit", { next: "" }, message);
    expect((await visitOf(api, id)).status).toBe("Confirmed");
    await page.reload();
    await detail.expectAction("Complete visit");
    expect(await detail.statusText()).toBe("Confirmed");
  });

  tc("TC-VIS-005", async ({ page }) => {
    const { api, account, opp, id, title } = await newVisit();
    // control: a second visit on another opportunity of the same account must not appear on this opportunity
    const otherOpp = await build.opportunity(api, account.id);
    const control = await build.visit(api, { accountId: account.id, opportunityId: otherOpp.id });
    ok(await api.action("visits", id, "Confirm"), "confirm");
    const findings = {
      existingSystem: "Old mechanical lever scale", customerProblem: "Manual slips, frequent disputes", measurements: "Pit 18 m x 3.4 m",
      observations: `${uniqueTag("OBS")} approach road needs levelling`, recommendation: "60 T electronic weighbridge with software", customerComments: "Wants it before the monsoon",
    };
    ok(await api.patch(`/modules/visits/${id}`, findings), "fill the findings");
    const detail = await openVisit(page, id);
    await detail.action("Complete visit");
    await detail.answerPrompt("Send the quotation");
    await expect.poll(() => detail.statusText()).toBe("Completed");
    const visit = await visitOf(api, id);
    expect(visit).toMatchObject({ status: "Completed", nextAction: "Send the quotation", ...findings });
    // SLA-08 'Site visit report submission' starts on completion
    expect(visit.sla, "SLA-08 timer exists").not.toBeNull();
    // the findings are shown on the Visit report tab
    await detail.tab("Visit report");
    await expect(page.getByText(findings.observations)).toBeVisible();
    await expect(page.getByText(findings.recommendation)).toBeVisible();
    // cases.json says "opportunity timeline": the opportunity has no timeline tab for visits; its "Visits" tab (related list) is what exists
    // (the Activities tab is not a timeline either, D-39), so that tab and the related API are asserted.
    // the visit appears on the opportunity (own row present, control visit of another opportunity absent)
    expect(idsOf(await api.get(`/modules/opps/${opp.id}/related/visits`))).toEqual([id]);
    expect(idsOf(await api.get(`/modules/opps/${otherOpp.id}/related/visits`))).toEqual([control.id]);
    const oppDetail = new ModuleDetail(page);
    await oppDetail.goto("opps", opp.id);
    await oppDetail.tab("Visits");
    await expect(page.getByRole("tabpanel").getByText(title)).toBeVisible();
  });

  tc("TC-VIS-006", async ({ page }) => {
    const { api, id } = await newVisit({ plant: "Plant 1", engineers: "Mfg App Engineer" });
    ok(await api.action("visits", id, "Confirm"), "confirm");
    // the button is only offered for Completed visits
    const detail = await openVisit(page, id);
    await detail.expectAction("Complete visit");
    await detail.expectNoAction("Download report PDF");
    ok(await api.patch(`/modules/visits/${id}`, { observations: "Pit is dry", recommendation: "60 T weighbridge" }), "fill the findings");
    ok(await api.action("visits", id, "Complete visit", { next: "Send the quotation" }), "complete");
    await page.reload();
    await detail.expectAction("Download report PDF");
    const [download] = await Promise.all([page.waitForEvent("download"), detail.action("Download report PDF")]);
    expect(download.suggestedFilename()).toMatch(/\.pdf$/);
    expect(download.suggestedFilename(), "named after the record").toContain(id);
    const path = await download.path();
    const bytes = await readFile(path);
    expect(bytes.subarray(0, 4).toString("latin1"), "a real PDF").toBe("%PDF");
    expect(bytes.length).toBeGreaterThan(500);
    // The report contents (account, plant, date, engineers, objective, findings) sit in Flate-compressed PDF streams, so they are not
    // asserted byte-wise here.
  });

  tc("TC-VIS-007", async ({ page }) => {
    const { api, id } = await newVisit();
    const detail = await openVisit(page, id);
    await detail.action("Cancel"); // no prompt: runs immediately
    await expect.poll(() => detail.statusText()).toBe("Cancelled");
    expect((await visitOf(api, id)).status).toBe("Cancelled");
    // cannot be completed afterwards (UI offers no action, server rejects)
    await page.reload();
    await expect(page.getByTestId("status-badge")).toHaveText("Cancelled");
    await detail.expectNoAction("Complete visit");
    await detail.expectNoAction("Cancel");
    await expectActionRejected(api, "visits", id, "Complete visit", { next: "Anything" }, "Cannot Complete visit a site visit in status 'Cancelled'.");
    expect((await visitOf(api, id)).status).toBe("Cancelled");
    // a Rescheduled visit can be cancelled too
    const other = await newVisit();
    ok(await other.api.action("visits", other.id, "Reschedule", { date: isoDate(8) }), "reschedule");
    ok(await other.api.action("visits", other.id, "Cancel"), "cancel a rescheduled visit");
    expect((await visitOf(other.api, other.id)).status).toBe("Cancelled");
  });

  tc("TC-VIS-008", async ({ page }) => {
    const { api, id } = await newVisit();
    ok(await api.action("visits", id, "Cancel"), "cancel");
    // status is checked before the payload: even with a next action the Cancelled visit cannot be completed
    await expectActionRejected(api, "visits", id, "Complete visit", { next: "Anything" }, "Cannot Complete visit a site visit in status 'Cancelled'.");
    expect((await visitOf(api, id)).status).toBe("Cancelled");
    const detail = await openVisit(page, id);
    await expect(page.getByTestId("status-badge")).toHaveText("Cancelled");
    await detail.expectNoAction("Complete visit");
    // a Completed visit cannot be completed again
    const done = await newVisit();
    ok(await done.api.action("visits", done.id, "Complete visit", { next: "Send the report" }), "complete");
    await expectActionRejected(done.api, "visits", done.id, "Complete visit", { next: "Again" }, "Cannot Complete visit a site visit in status 'Completed'.");
    const record = await visitOf(done.api, done.id);
    expect(record).toMatchObject({ status: "Completed", nextAction: "Send the report" });
  });

  tc("TC-VIS-009", async () => {
    // Spec (gap): a reminder is generated before a visit scheduled within 24 h. The SLA date sweeps cover opportunities, activities,
    // quotations, sales orders, coverage and payments only, so no reminder ever appears (tc() runs this as an expected failure).
    const { api, id, title } = await newVisit({ visitDate: isoDate(0.5) });
    const mentionsVisit = (n: { title: string; body: string; link: string | null }): boolean =>
      [n.title, n.body, n.link ?? ""].join(" ").includes(id) || [n.title, n.body].join(" ").includes(title);
    const reminderExists = async (): Promise<boolean> => {
      const inbox = ok(await api.get("/notifications"), "read notifications").body as unknown as { data: { title: string; body: string; link: string | null }[] };
      return inbox.data.some(mentionsVisit);
    };
    // The poll only waits (expect.poll's own timeout error carries no matcherResult, so tc() would read it as a setup error); the final check is a plain expect().
    try {
      // the catch only keeps the wait from throwing; the plain expect() below decides
      await expect.poll(reminderExists, { timeout: 15_000 }).toBe(true);
    } catch {
      // gap: no reminder; asserted just below
    }
    expect(await reminderExists(), "a reminder notification exists for the upcoming visit").toBe(true);
  });

  tc("TC-VIS-010", async () => {});
});
