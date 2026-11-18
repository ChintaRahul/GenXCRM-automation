// e2e/specs/mfg/apr.spec.ts - Commercial approvals (TC-APR-001..011): inbox, approve / return / reject, terminal guard, quotation linkage, chain events,
// admin-configurable matrix, seeded default rules, credit-term approvals (gap) and the SLA-14 timer.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { authFile, type MfgRoleKey } from "../../fixtures/mfgUsers";
import { ModuleDetail } from "../../pages/mfg/ModuleDetail";
import { ModuleList } from "../../pages/mfg/ModuleList";
import { apiAs, ApiClient, build, ok, type ApiResult } from "../../mfg/api";
import { tc } from "../../mfg/caseTest";
import { readApprovalRule, readOrgApprovalRules, restoreApprovalRulesIfNeeded, slaTimersOf, withApprovalRuleOverride } from "../../mfg/db";
import { expectActionRejected, knownDefect } from "../../mfg/guards";

type Rec = Record<string, unknown>;
type Sla = { l: string; t: string } | null;

const rec = (r: ApiResult, what: string): Rec => ok(r, what).body as Rec;
const userIdOf = async (role: MfgRoleKey): Promise<string> => {
  const { token } = await apiAs(role);
  const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { sub?: string; id?: string };
  const id = payload.sub ?? payload.id;
  if (!id) throw new Error(`no user id in the JWT of ${role}`);
  return id;
};
const approvalOf = async (api: ApiClient, id: string): Promise<Rec> => rec(await api.get(`/modules/approvals/${id}`), "read approval");
/** Org A's id, read from a record the E2E org owns. */
const orgIdOf = async (accountId: string): Promise<string> => rec(await (await apiAs("salesExec1")).get(`/modules/accounts/${accountId}`), "read account").orgId as string;

/** Account + opportunity (owned by salesExec1) + product (Commercial) and one submitted quotation at `discountPct`; returns its single Discount approval. */
const newApproval = async (discountPct = 8) => {
  const sales = await apiAs("salesExec1");
  const account = await build.account(sales);
  const opp = await build.opportunity(sales, account.id);
  const product = await build.product(await apiAs("commercial"));
  const q = await build.submittedQuotation(sales, { opportunityId: opp.id, accountId: account.id, productId: product.id, discountPct });
  expect(q.status).toBe("Approval pending");
  // the list ignores ?entityId, so filter client-side (the title carries the unique quotation id, which ?search matches)
  const list = ok(await (await apiAs("director")).get(`/modules/approvals?search=${q.id}`), "list approvals").body.data ?? [];
  const mine = list.filter((a) => a.entityId === q.id);
  expect(mine, "exactly one approval per submit").toHaveLength(1);
  return { sales, account, opp, quoteId: q.id, approvalId: mine[0]?.id as string, title: mine[0]?.title as string };
};
const openDetail = async (page: Page, id: string): Promise<ModuleDetail> => {
  const detail = new ModuleDetail(page);
  await detail.goto("approvals", id);
  return detail;
};
type RuleShape = { type: string; min: number; max: number; approverRole: string };
const DEFAULT_RULES: RuleShape[] = [
  { type: "CreditTerms", min: 45, max: 60, approverRole: "Accounts" },
  { type: "CreditTerms", min: 60, max: 120, approverRole: "Director" },
  { type: "Discount", min: 0, max: 5, approverRole: "Salesperson" },
  { type: "Discount", min: 5, max: 10, approverRole: "Sales Manager" },
  { type: "Discount", min: 10, max: 15, approverRole: "Sales Head" },
  { type: "Discount", min: 15, max: 100, approverRole: "Director" },
  { type: "Margin", min: 0, max: 15, approverRole: "Director" },
  { type: "Margin", min: 15, max: 20, approverRole: "Sales Head" },
];
const ruleKey = (r: RuleShape): string => `${r.type}-${String(r.min).padStart(3, "0")}`;

// A previous run that died while an approval rule was overridden (TC-APR-008) is healed before anything depends on routing.
test.beforeAll(async () => {
  await restoreApprovalRulesIfNeeded();
});

test.describe("APR - drift guard", () => {
  test("the spec's default rules mirror the backend seed constants", () => {
    const src = readFileSync(resolve(__dirname, "../../../backend/src/modules/manufacturing-defaults/manufacturing-defaults.data.ts"), "utf8");
    const block = /APPROVAL_RULE_DEFAULTS[^=]*=\s*\[([\s\S]*?)\n\];/.exec(src)?.[1] ?? "";
    const seeded: RuleShape[] = [...block.matchAll(/type: '(\w+)', min: (\d+), max: (\d+), approverRole: '([^']+)'/g)]
      .map((m) => ({ type: m[1] ?? "", min: Number(m[2]), max: Number(m[3]), approverRole: m[4] ?? "" }));
    expect(seeded).toHaveLength(8);
    expect([...seeded].sort((a, b) => ruleKey(a).localeCompare(ruleKey(b)))).toEqual([...DEFAULT_RULES].sort((a, b) => ruleKey(a).localeCompare(ruleKey(b))));
  });
});

test.describe("APR - Sales Manager", () => {
  test.use({ storageState: authFile("salesManager") });

  tc("TC-APR-001", async ({ page }) => {
    test.slow(); // cold stack
    const { quoteId, approvalId, title } = await newApproval(8);
    const manager = await apiAs("salesManager");
    // the inbox (org-wide list) offers the request to the approver role
    const listed = (ok(await manager.get(`/modules/approvals?search=${quoteId}`), "manager list").body.data ?? []).filter((a) => a.entityId === quoteId);
    expect(listed.map((a) => a.id)).toEqual([approvalId]);
    const salesId = await userIdOf("salesExec1");
    expect(listed[0]).toMatchObject({ entityType: "Quotation", type: "Discount", status: "Requested", currentApprover: "Sales Manager", requestedById: salesId });
    const ruleId = listed[0]?.matchedRule as string;
    expect(await readApprovalRule(ruleId)).toMatchObject({ type: "Discount", min: 5, max: 10, approverRole: "Sales Manager" });
    // SLA-14 timer exists and is running
    expect((listed[0]?.sla as Sla)?.l, "SLA-14 label").toMatch(/^Due in /);
    expect(await slaTimersOf(approvalId)).toEqual([{ name: "Approval turnaround", open: true }]);
    // UI: the row shows request, quotation id, type, approver, requester, status
    const list = new ModuleList(page, "approvals");
    await list.goto();
    await list.search(quoteId);
    const row = list.row(quoteId);
    await expect(row).toBeVisible();
    await expect(row).toContainText(title);
    await expect(row).toContainText("Discount");
    await expect(row).toContainText("Sales Manager");
    await expect(row).toContainText("Mfg Sales Exec 1"); // the requester column shows the requester's name
    await expect(row).toContainText("Requested");
    // Spec: the Approval SLA column shows the running SLA-14 timer; the cell renders the sla object as "[object Object]" (same root cause as D-16).
    await expect(row).toContainText("Due in", { timeout: 1_000 });
    // detail: the routing section
    const detail = await openDetail(page, approvalId);
    expect(await detail.statusText()).toBe("Requested");
    await expect(page.getByText("Quotation", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Sales Manager", { exact: true }).first()).toBeVisible();
    // Spec: the matched rule is shown. The registry fields use keys `rule` / `requested` / `level` while the API returns `matchedRule` / `requestedAt`
    // (and never sets level), so Matched rule, Requested on and Level render "—".
    await expect(page.getByText("Matched rule", { exact: true }).first(), "matched rule field on the detail").toBeVisible({ timeout: 1_000 });
  });

  tc("TC-APR-002", async ({ page }) => {
    const { approvalId } = await newApproval(8);
    const manager = await apiAs("salesManager");
    const detail = await openDetail(page, approvalId);
    expect(await detail.statusText()).toBe("Requested");
    await detail.action("Approve");
    await detail.answerPrompt("Approved within the manager discount authority");
    await expect.poll(() => detail.statusText()).toBe("Approved");
    const approval = await approvalOf(manager, approvalId);
    expect(approval).toMatchObject({ status: "Approved", approverComments: "Approved within the manager discount authority" });
    // SLA-14 stops on the decision
    expect((approval.sla as Sla)?.l).toBe("Met");
    expect(await slaTimersOf(approvalId)).toEqual([{ name: "Approval turnaround", open: false }]);
    await page.reload();
    await expect(page.getByText("Approved within the manager discount authority")).toBeVisible();
    await detail.expectNoAction("Approve");
    // optional comments: approving without comments is allowed
    const second = await newApproval(8);
    const r = rec(await manager.action("approvals", second.approvalId, "Approve"), "approve without comments");
    expect(r).toMatchObject({ status: "Approved", approverComments: null });
  });

  tc("TC-APR-003", async ({ page }) => {
    const { approvalId } = await newApproval(8);
    const manager = await apiAs("salesManager");
    const detail = await openDetail(page, approvalId);
    // server guard (plain action rejections are not shown in the UI): blank comments
    await expectActionRejected(manager, "approvals", approvalId, "Return for revision", {}, "'comments' is required to Return for revision.");
    await expectActionRejected(manager, "approvals", approvalId, "Return for revision", { comments: "" }, "'comments' is required to Return for revision.");
    expect((await approvalOf(manager, approvalId)).status).toBe("Requested");
    // UI: the dialog does not let a blank comment through
    await detail.action("Return for revision");
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator("#action-ask-field")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Confirm", exact: true })).toBeDisabled();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    expect(await detail.statusText()).toBe("Requested");
    expect((await approvalOf(manager, approvalId)).status).toBe("Requested");
    // with comments
    await detail.action("Return for revision");
    await detail.answerPrompt("Please lower the discount to 5%");
    await expect.poll(() => detail.statusText()).toBe("Returned for revision");
    const approval = await approvalOf(manager, approvalId);
    expect(approval).toMatchObject({ status: "Returned for revision", approverComments: "Please lower the discount to 5%" });
    expect((approval.sla as Sla)?.l, "SLA-14 stops on a return").toBe("Met");
  });

  tc("TC-APR-004", async ({ page }) => {
    const { approvalId } = await newApproval(8);
    const manager = await apiAs("salesManager");
    const detail = await openDetail(page, approvalId);
    await expectActionRejected(manager, "approvals", approvalId, "Reject", {}, "'comments' is required to Reject.");
    expect((await approvalOf(manager, approvalId)).status).toBe("Requested");
    await detail.action("Reject");
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator("#action-ask-field")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Confirm", exact: true })).toBeDisabled();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    expect(await detail.statusText()).toBe("Requested");
    await detail.action("Reject");
    await detail.answerPrompt("Discount not justified");
    await expect.poll(() => detail.statusText()).toBe("Rejected");
    const approval = await approvalOf(manager, approvalId);
    expect(approval).toMatchObject({ status: "Rejected", approverComments: "Discount not justified" });
    expect((approval.sla as Sla)?.l, "SLA-14 stops on a rejection").toBe("Met");
  });

  tc("TC-APR-005", async ({ page }) => {
    const { approvalId } = await newApproval(8);
    const manager = await apiAs("salesManager");
    ok(await manager.action("approvals", approvalId, "Approve"), "approve");
    const detail = await openDetail(page, approvalId);
    expect(await detail.statusText()).toBe("Approved");
    for (const action of ["Approve", "Reject", "Return for revision"]) await detail.expectNoAction(action);
    await expectActionRejected(manager, "approvals", approvalId, "Reject", { comments: "too late" }, "Cannot Reject an approval in status 'Approved'.");
    await expectActionRejected(manager, "approvals", approvalId, "Approve", {}, "Cannot Approve an approval in status 'Approved'.");
    await expectActionRejected(manager, "approvals", approvalId, "Return for revision", { comments: "too late" }, "Cannot Return for revision an approval in status 'Approved'.");
    expect((await approvalOf(manager, approvalId)).status).toBe("Approved");
    await page.reload();
    expect(await detail.statusText()).toBe("Approved");
    // a rejected approval is terminal too
    const second = await newApproval(8);
    ok(await manager.action("approvals", second.approvalId, "Reject", { comments: "no" }), "reject");
    await expectActionRejected(manager, "approvals", second.approvalId, "Approve", {}, "Cannot Approve an approval in status 'Rejected'.");
  });

  tc("TC-APR-006", async ({ page }) => {
    const { approvalId, quoteId } = await newApproval(8);
    const manager = await apiAs("salesManager");
    const sales = await apiAs("salesExec1");
    const detail = await openDetail(page, approvalId);
    await detail.action("Approve");
    await detail.answerPrompt("ok");
    await expect.poll(() => detail.statusText()).toBe("Approved");
    // Spec: the quotation unblocks once its approval is approved.
    // Verified behaviour: Approvals.performAction only updates the Approval; the quotation stays 'Approval pending' and Mark sent fails.
    // Only the quotation's own Approve action moves it.
    const quoteStatus = async (): Promise<string> => rec(await manager.get(`/modules/quotes/${quoteId}`), "read quotation").status as string;
    await knownDefect(test.info(), "D-76", async () => {
      expect(await quoteStatus(), "quotation status after its approval was approved").toBe("Approved");
    });
    expect(await quoteStatus(), "current behaviour: the quotation is still waiting").toBe("Approval pending");
    await expectActionRejected(sales, "quotes", quoteId, "Mark sent", {}, "Cannot Mark sent a quotation in status 'Approval pending'");
    const quoteDetail = new ModuleDetail(page);
    await quoteDetail.goto("quotes", quoteId);
    expect(await quoteDetail.statusText()).toBe("Approval pending");
    await quoteDetail.expectNoAction("Mark sent");
    // the quotation's own Approve works afterwards
    ok(await manager.action("quotes", quoteId, "Approve"), "approve the quotation itself");
    expect(await quoteStatus()).toBe("Approved");
    ok(await sales.action("quotes", quoteId, "Mark sent"), "mark sent");
    expect(await quoteStatus()).toBe("Sent");
  });

  tc("TC-APR-007", async ({ page }) => {
    const { approvalId } = await newApproval(8);
    const manager = await apiAs("salesManager");
    const before = await approvalOf(manager, approvalId);
    ok(await manager.action("approvals", approvalId, "Reject", { comments: "chain test" }), "reject");
    const after = await approvalOf(manager, approvalId);
    const detail = await openDetail(page, approvalId);
    await detail.tab("Approval chain");
    const panel = page.getByRole("tabpanel");
    await expect(panel.getByText("Requested", { exact: true })).toBeVisible();
    await expect(panel.getByText("Rejected", { exact: true })).toBeVisible();
    // order in the UI: Requested before the decision
    const text = await panel.innerText();
    expect(text.indexOf("Requested")).toBeLessThan(text.indexOf("Rejected"));
    // API events with timestamps
    const events = ok(await manager.get(`/modules/approvals/${approvalId}/events/chain`), "chain events").body as unknown as { id: string; at: string; label: string }[];
    expect(events.map((e) => e.label)).toEqual(["Requested", "Rejected"]);
    expect(events[0]?.at).toBe(before.requestedAt);
    expect(events[1]?.at).toBe(after.updatedAt);
    expect(Date.parse(events[1]?.at ?? "")).toBeGreaterThanOrEqual(Date.parse(events[0]?.at ?? ""));
  });

  tc("TC-APR-011", async () => {
    const { approvalId } = await newApproval(8);
    const manager = await apiAs("salesManager");
    // Only the SLA-14 timer is asserted here: a fresh approval has a running 'Approval turnaround' timer. Observing the breach and the escalation
    // (notification / email to the next level) needs a waited-out target and belongs to the SLA task (Task 11b).
    const approval = await approvalOf(manager, approvalId);
    expect((approval.sla as Sla)?.l).toMatch(/^Due in /);
    expect(await slaTimersOf(approvalId)).toEqual([{ name: "Approval turnaround", open: true }]);
  });
});

test.describe("APR - Super Admin", () => {
  test.use({ storageState: authFile("superAdmin") });

  tc("TC-APR-008", async ({ page }) => {
    test.slow();
    const probe = await newApproval(8);
    const org = await orgIdOf(probe.account.id);
    // Admin UI: the Approval rules tab lists the rules.
    await page.goto("/administration");
    await page.getByRole("button", { name: /Approval rules/i }).click();
    await expect(page.getByRole("row").filter({ hasText: "Sales Manager" }).first()).toBeVisible({ timeout: 1_000 });
    // Routing proof through the guarded DB helper: Discount 5-10 -> Sales Head, applied to the very next submit, restored afterwards.
    const before = await readOrgApprovalRules(org);
    const rule = before.find((r) => r.type === "Discount" && r.min === 5 && r.max === 10);
    expect(rule).toMatchObject({ approverRole: "Sales Manager", isActive: true });
    const routed = await withApprovalRuleOverride(org, { type: "Discount", min: 5, max: 10 }, { approverRole: "Sales Head" }, async () => newApproval(8));
    const approval = await approvalOf(await apiAs("salesHead"), routed.approvalId);
    expect(approval).toMatchObject({ type: "Discount", status: "Requested", currentApprover: "Sales Head", matchedRule: rule?.id });
    // restored exactly: the rules are what they were, and the next 8% submit goes to the Sales Manager again
    expect(await readOrgApprovalRules(org)).toEqual(before);
    const again = await newApproval(8);
    expect((await approvalOf(await apiAs("salesManager"), again.approvalId)).currentApprover).toBe("Sales Manager");
  });

  tc("TC-APR-009", async ({ page }) => {
    const probe = await newApproval(8);
    const org = await orgIdOf(probe.account.id);
    // The rules API is 403 (D-50), so the seeded rows are read from the database.
    const rules = await readOrgApprovalRules(org);
    expect(rules.map(({ type, min, max, approverRole }) => ({ type, min, max, approverRole })), "exactly the 8 default rules").toEqual(DEFAULT_RULES);
    expect(rules.every((r) => r.isActive)).toBe(true);
    // Spec: Administration -> Approval rules lists them
    await page.goto("/administration");
    await page.getByRole("button", { name: /Approval rules/i }).click();
    await expect(page.getByRole("row").filter({ hasText: "CreditTerms" }).first()).toBeVisible({ timeout: 1_000 });
  });

  tc("TC-APR-010", async () => {
    // Spec: a PO / quotation with 90-day credit requests a CreditTerms approval (60-120 band -> Director).
    const sales = await apiAs("salesExec1");
    const director = await apiAs("director");
    const account = await build.account(sales);
    const opp = await build.opportunity(sales, account.id);
    const product = await build.product(await apiAs("commercial"));
    const quote = await build.approvedQuotation(sales, { opportunityId: opp.id, accountId: account.id, productId: product.id, discountPct: 0 }); // quotation payment terms are an enum without a 90-day option; the PO takes free text
    const po = await build.acceptedPo(director, { opportunityId: opp.id, accountId: account.id, quotationId: quote.id, paymentTerms: "90 days credit" });
    const list = ok(await director.get("/modules/approvals?limit=100&sort=-createdAt"), "list approvals").body.data ?? [];
    const credit = list.filter((a) => a.type === "CreditTerms" && (a.entityId === po.id || a.entityId === quote.id));
    expect(credit, "a CreditTerms approval for the PO or quotation").toHaveLength(1);
    expect(credit[0]).toMatchObject({ status: "Requested", currentApprover: "Director" });
  });
});
