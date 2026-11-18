// e2e/specs/mfg/svc.spec.ts - Service tickets (TC-SVC-001..012): create + SLA start, types, status flow with its guards, priority SLA targets,
// service history, repeat-failure gap, warranty / chargeable status.
// NOTE (D-102): ticket reads are own-record scoped by `engineerId` for every non-Director user, so the Service Manager gets 404 for any ticket that is not
// assigned to her. Cases that need to OPEN an unassigned ticket in the browser run as the Director (a role that sees it) and assert the Service
// Manager's view as the defect.
import { expect, test, type Page } from "@playwright/test";
import { authFile, type MfgRoleKey } from "../../fixtures/mfgUsers";
import { ModuleDetail } from "../../pages/mfg/ModuleDetail";
import { ModuleDrawer } from "../../pages/mfg/ModuleDrawer";
import { apiAs, ApiClient, build, ok, type ApiResult } from "../../mfg/api";
import { tc } from "../../mfg/caseTest";
import { slaTimerWindows } from "../../mfg/db";
import { expectActionRejected, knownDefect } from "../../mfg/guards";
import { uniqueTag } from "../../mfg/tag";

type Rec = Record<string, unknown>;
type Asset = Awaited<ReturnType<typeof build.asset>>;

const HOUR_MS = 3_600_000;
const SLA19 = "Service first response";
const SLA20 = "Service resolution";

const rec = (r: ApiResult, what: string): Rec => ok(r, what).body as Rec;
const userIdOf = async (role: MfgRoleKey): Promise<string> => {
  const { token } = await apiAs(role);
  const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { sub?: string; id?: string };
  const id = payload.sub ?? payload.id;
  if (!id) throw new Error(`no user id in the JWT of ${role}`);
  return id;
};
const archiveQuietly = async (key: string, ids: string[]): Promise<void> => {
  const director = await apiAs("director");
  for (const id of ids) {
    try {
      await director.post(`/modules/${key}/${id}/archive`);
    } catch {
      // cleanup only
    }
  }
};

// One commissioned asset (and account) shared by the cases of this file that do not care about the asset.
let sharedAsset: Promise<Asset> | undefined;
const asset = (): Promise<Asset> => (sharedAsset ??= build.asset());
const tickets: string[] = [];
const extraAssets: string[] = [];
/** Ticket created through the API by the Service Manager (the role that may create tickets). */
const newTicket = async (over: Rec = {}, a?: Asset): Promise<{ id: string; a: Asset }> => {
  const target = a ?? (await asset());
  const sm = await apiAs("serviceManager");
  const r = rec(await sm.post("/modules/service", {
    accountId: target.account.id, assetId: target.assetId, complaintType: "Breakdown", priority: "High", description: `${uniqueTag("TKT")} E2E ticket`, ...over,
  }), "create ticket");
  tickets.push(r.id as string);
  return { id: r.id as string, a: target };
};
const director = (): Promise<ApiClient> => apiAs("director");
const ticketOf = async (id: string): Promise<Rec> => rec(await (await director()).get(`/modules/service/${id}`), "read ticket (Director)");
const statusOf = async (id: string): Promise<unknown> => (await ticketOf(id)).status;
/** Ticket advanced through the API: assigned to the Service Engineer, optionally further. */
type Stage = "Open" | "Assigned" | "Visit scheduled" | "In progress" | "Resolved";
const ticketAt = async (stage: Stage, over: Rec = {}): Promise<{ id: string; a: Asset }> => {
  const t = await newTicket(over);
  const dir = await director(); // the Service Manager cannot act on unassigned tickets (D-102)
  const engineer = await userIdOf("serviceEngineer");
  const steps: [Stage, string, Rec][] = [
    ["Assigned", "Assign engineer", { engineer }],
    ["Visit scheduled", "Schedule visit", { visitDate: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10) }],
    ["In progress", "Start work", {}],
    ["Resolved", "Resolve", { resolution: "Replaced the load cell and recalibrated" }],
  ];
  for (const [target, action, payload] of steps) {
    if (stage === "Open") break;
    const as = action === "Start work" || action === "Resolve" ? await apiAs("serviceEngineer") : dir;
    ok(await as.action("service", t.id, action, payload), action);
    if (target === stage) break;
  }
  return t;
};
const openTicket = async (page: Page, id: string): Promise<ModuleDetail> => {
  const detail = new ModuleDetail(page);
  await detail.goto("service", id);
  return detail;
};
/** Reloads the detail page and waits for the loaded header (the status bar renders only after the record arrived). */
const reloaded = async (page: Page): Promise<void> => {
  await page.reload();
  await expect(page.getByRole("button", { name: "More actions", exact: true })).toBeVisible();
};
const fieldValue = (page: Page, label: string) => page.locator(`p:text-is('${label}') + p`);
const stepLabel = (page: Page) => page.locator('[data-testid="status-step"][data-current="true"] span').last();

test.afterAll(async () => {
  await archiveQuietly("service", tickets);
  await archiveQuietly("assets", [...extraAssets, ...(sharedAsset ? [(await sharedAsset).assetId] : [])]);
});

test.describe("Service tickets - Service Manager", () => {
  test.use({ storageState: authFile("serviceManager") });

  tc("TC-SVC-001", async ({ page }) => {
    const a = await asset();
    const description = `${uniqueTag("SVC1")} weighbridge dead after storm`;
    const list = "/service-tickets";
    await page.goto(list);
    await page.getByRole("button", { name: /^New [^(]/ }).click();
    const drawer = new ModuleDrawer(page);
    await drawer.fill({ description, accountId: a.account.id, assetId: a.assetId, complaintType: "Breakdown", priority: "Critical" });
    await drawer.save();
    // the ticket exists (read as the Director) and is Open with both SLA timers running
    const dir = await director();
    let id = "";
    await expect.poll(async () => {
      const rows = ok(await dir.get(`/modules/service?limit=100&sort=createdAt:desc`), "tickets").body.data ?? [];
      id = (rows.find((t) => t.description === description)?.id as string | undefined) ?? "";
      return id;
    }, { message: "ticket saved from the New drawer" }).not.toBe("");
    tickets.push(id);
    expect(await ticketOf(id)).toMatchObject({ status: "Open", assetId: a.assetId, accountId: a.account.id, complaintType: "Breakdown", priority: "Critical" });
    const timers = await slaTimerWindows(id);
    expect(timers.map((t) => t.name).sort(), "SLA-19 and SLA-20 started on create").toEqual([SLA19, SLA20]);
    expect(timers.every((t) => t.open), "both timers are running").toBe(true);
    // priority-specific targets: Critical = 2 h first response, 24 h resolution (24x7 calendar)
    expect(timers.find((t) => t.name === SLA19)?.windowMs).toBe(2 * HOUR_MS);
    expect(timers.find((t) => t.name === SLA20)?.windowMs).toBe(24 * HOUR_MS);
    // The Service Manager who saved it cannot open it afterwards: she is not the ticket's engineer (D-102)
    const sm = await apiAs("serviceManager");
    const read = await sm.get(`/modules/service/${id}`);
    if (read.status !== 200) expect([read.status, ApiClient.message(read)], "current: own-record scope hides the ticket (remove with D-102)").toEqual([404, `Service ticket '${id}' not found.`]);
    expect(read.status, "Service Manager reads the ticket she just created").toBe(200);
    await expect(page).toHaveURL(new RegExp(`${list}/${id}$`));
    await expect(page.getByRole("button", { name: "More actions", exact: true })).toBeVisible({ timeout: 3_000 });
  });

  tc("TC-SVC-002", async ({ page }) => {
    await page.goto("/service-tickets");
    await page.getByRole("button", { name: /^New [^(]/ }).click();
    const field = page.locator("#complaintType");
    await expect(field).toBeVisible();
    const options = (await field.evaluate((n) => (n instanceof HTMLSelectElement ? Array.from(n.options).map((o) => o.value) : []))).filter((o) => o !== "");
    // Spec: Breakdown, Calibration and 'Preventive visit' are available. Breakdown and Calibration exist; the product has 'Preventive maintenance' instead (D-110).
    for (const type of ["Breakdown", "Calibration"]) expect(options, `option ${type}`).toContain(type);
    expect(options).toEqual(["Breakdown", "Calibration", "Preventive maintenance", "Installation issue", "Software / integration"]);
    // the server accepts each of them and rejects an unknown type
    const a = await asset();
    const sm = await apiAs("serviceManager");
    for (const type of options) {
      const t = await newTicket({ complaintType: type }, a);
      expect((await ticketOf(t.id)).complaintType).toBe(type);
    }
    const bad = await sm.post("/modules/service", { accountId: a.account.id, assetId: a.assetId, complaintType: "Preventive visit", priority: "High", description: "x" });
    if (bad.status !== 201) expect([bad.status, JSON.stringify(bad.body.message)], "current: 'Preventive visit' is refused (remove with D-110)").toEqual([400, expect.stringContaining("complaintType must be one of the following values: Breakdown, Calibration, Preventive maintenance, Installation issue, Software / integration")]);
    await knownDefect(test.info(), "D-110", async () => {
      expect(options, "complaint type options").toEqual(expect.arrayContaining(["Preventive visit"]));
      expect(bad.status, "ticket with complaint type 'Preventive visit'").toBe(201);
    });
    if (bad.status === 201) tickets.push(bad.body.id as string);
    const nonsense = await sm.post("/modules/service", { accountId: a.account.id, assetId: a.assetId, complaintType: "Nonsense type", priority: "High", description: "x" });
    expect(nonsense.status, "unknown complaint type").toBe(400);
  });

  tc("TC-SVC-011", async () => {
    // GAP (spec: three tickets on one asset in a short period flag the asset / account for management review).
    // Setup and preconditions use plain errors; only the last check is an expect().
    const a = await build.asset();
    extraAssets.push(a.assetId);
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) ids.push((await newTicket({ complaintType: "Breakdown", priority: "High" }, a)).id);
    const dir = await director();
    const onAsset = (ok(await dir.get(`/modules/assets/${a.assetId}/related/service?limit=100`), "tickets of the asset").body.data ?? []).filter((t) => t.complaintType === "Breakdown").map((t) => t.id as string);
    if (ids.some((id) => !onAsset.includes(id))) throw new Error("precondition: the three Breakdown tickets are not all on the asset");
    const assetRecord = rec(await dir.get(`/modules/assets/${a.assetId}`), "read asset");
    const accountRecord = rec(await dir.get(`/modules/accounts/${a.account.id}`), "read account");
    const notices = ok(await (await apiAs("serviceManager")).get("/notifications"), "Service Manager notifications").body as unknown as Rec[] | Rec;
    const noticeText = JSON.stringify(notices);
    const flagKeys = [...Object.keys(assetRecord), ...Object.keys(accountRecord)].filter((k) => /repeat|flag|review|chronic/i.test(k));
    const flagged = flagKeys.length > 0 || noticeText.includes(a.serial) || noticeText.includes(a.assetId);
    expect(flagged, "asset / account carries a repeat-failure flag, or management is notified").toBe(true);
  });

  tc("TC-SVC-012", async () => {
    const a = await build.asset();
    extraAssets.push(a.assetId);
    const sm = await apiAs("serviceManager");
    // asset under warranty: nothing derives the ticket's coverage / chargeable flags from it
    const inWarranty = await newTicket({}, a);
    const first = await ticketOf(inWarranty.id);
    if (first.coverage === null) expect([first.coverage, first.chargeable], "current: both stay unset, they are not derived (remove with D-106)").toEqual([null, null]);
    // the warranty ends: a ticket raised afterwards is still not marked chargeable
    ok(await sm.patch(`/modules/assets/${a.assetId}`, { warrantyEnd: new Date(Date.now() - 86_400_000).toISOString() }), "end the warranty yesterday");
    const expired = await newTicket({}, a);
    const second = await ticketOf(expired.id);
    if (second.coverage === null) expect([second.coverage, second.chargeable], "current: still unset after the warranty ended (remove with D-106)").toEqual([null, null]);
    // the fields can be set by hand
    const manual = await newTicket({ coverage: "Chargeable", chargeable: true }, a);
    expect(await ticketOf(manual.id)).toMatchObject({ coverage: "Chargeable", chargeable: true });
    // Spec: the warranty status / chargeable flag reflects the coverage of the asset
    await knownDefect(test.info(), "D-106", async () => {
      expect(first.coverage, "ticket on an asset under warranty").toBe("In warranty");
      expect(second.coverage, "ticket on an asset whose warranty ended").toBe("Chargeable");
      expect(second.chargeable, "chargeable flag after the warranty ended").toBe(true);
    });
  });
});

test.describe("Service tickets - Service Manager (assign / start / resolve)", () => {
  test.use({ storageState: authFile("serviceManager") });

  tc("TC-SVC-003", async ({ page }) => {
    const t = await newTicket();
    const engineer = await userIdOf("serviceEngineer");
    const dir = await apiAs("serviceManager"); // the Service Manager reads every ticket (record access: all), so she can assign an engineer
    expect(await statusOf(t.id)).toBe("Open");
    // missing engineer: refused by the server, status unchanged
    await expectActionRejected(dir, "service", t.id, "Assign engineer", {}, "'engineer' is required to Assign engineer.");
    expect(await statusOf(t.id)).toBe("Open");
    // UI: the prompt cannot be confirmed while blank; with an engineer the ticket is Assigned and SLA-19 stops (SLA-20 keeps running)
    const detail = await openTicket(page, t.id);
    expect(await detail.statusText()).toBe("Open");
    await detail.action("Assign engineer");
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Confirm", exact: true })).toBeDisabled();
    // Spec: the engineer is picked from the users; the prompt is a free-text box in which a user id has to be typed (D-107)
    expect(await page.locator("#action-ask-field").evaluate((n) => n.tagName.toLowerCase()), "engineer prompt control").toBe("select");
    await detail.answerPrompt(engineer);
    await expect.poll(() => statusOf(t.id), { message: "status after Assign engineer" }).toBe("Assigned");
    expect((await ticketOf(t.id)).engineerId).toBe(engineer);
    const timers = await slaTimerWindows(t.id);
    expect(timers.find((x) => x.name === SLA19)?.open, "SLA-19 stopped on assignment").toBe(false);
    expect(timers.find((x) => x.name === SLA20)?.open, "SLA-20 still running").toBe(true);
    await reloaded(page);
    expect(await detail.statusText()).toBe("Assigned");
    // the Work log tab shows the assigned engineer (the field reads registry key `engineer`, the record carries `engineerId`, D-107)
    await detail.tab("Work log");
    await expect(fieldValue(page, "Customer confirmation")).toBeVisible(); // tab loaded
    await expect(fieldValue(page, "Assigned engineer")).toHaveText(engineer, { timeout: 1_000 });
  });

  tc("TC-SVC-004", async ({ page }) => {
    const t = await ticketAt("Assigned");
    const sm = await director();
    await expectActionRejected(sm, "service", t.id, "Schedule visit", {}, "'visitDate' is required to Schedule visit.");
    expect(await statusOf(t.id)).toBe("Assigned");
    const detail = await openTicket(page, t.id);
    expect(await detail.statusText()).toBe("Assigned");
    await detail.action("Schedule visit");
    await expect(page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true })).toBeDisabled();
    const day = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    await detail.answerPrompt(day);
    await expect.poll(() => statusOf(t.id), { message: "status after Schedule visit" }).toBe("Visit scheduled");
    expect((await ticketOf(t.id)).visitDate).toBe(`${day}T00:00:00.000Z`);
    await reloaded(page);
    expect(await detail.statusText()).toBe("Visit scheduled");
    // not allowed outside Assigned
    await detail.expectNoAction("Schedule visit");
    await expectActionRejected(sm, "service", t.id, "Schedule visit", { visitDate: day }, "Cannot Schedule visit a service ticket in status 'Visit scheduled'.");
  });

  tc("TC-SVC-007", async ({ page }) => {
    // Resolved -> Request confirmation -> Customer confirmation -> Close -> Closed
    const t = await ticketAt("Resolved");
    const detail = await openTicket(page, t.id);
    expect(await detail.statusText()).toBe("Resolved");
    await detail.action("Request confirmation");
    await expect.poll(() => statusOf(t.id), { message: "status after Request confirmation" }).toBe("Customer confirmation");
    await reloaded(page);
    expect(await detail.statusText()).toBe("Customer confirmation");
    await detail.action("Close");
    await expect.poll(() => statusOf(t.id), { message: "status after Close" }).toBe("Closed");
    await reloaded(page);
    expect(await detail.statusText()).toBe("Closed");
    await detail.expectNoAction("Close");
    await detail.expectNoAction("Request confirmation");
    // Close is also allowed directly from Resolved
    const direct = await ticketAt("Resolved");
    const sm = await director();
    ok(await sm.action("service", direct.id, "Close"), "close from Resolved");
    expect(await statusOf(direct.id)).toBe("Closed");
    // and nothing reopens a closed ticket
    await expectActionRejected(sm, "service", direct.id, "Request confirmation", {}, "Cannot Request confirmation a service ticket in status 'Closed'.");
  });

  tc("TC-SVC-008", async ({ page }) => {
    const t = await newTicket();
    const sm = await director();
    await expectActionRejected(sm, "service", t.id, "Close", {}, "Cannot Close a service ticket in status 'Open'.");
    expect(await statusOf(t.id), "ticket unchanged").toBe("Open");
    const detail = await openTicket(page, t.id);
    expect(await detail.statusText()).toBe("Open");
    await detail.expectNoAction("Close");
    await detail.expectAction("Assign engineer");
    expect(await statusOf(t.id)).toBe("Open");
  });

  tc("TC-SVC-009", async () => {
    // SLA-19 / SLA-20 targets per priority (seed: Critical 2h/24h, High 4h/48h, Medium 1d/5d, Low 2d/10d; 24x7 calendar). Breaches are covered by the SLA module.
    const expected: Record<string, [number, number]> = {
      Critical: [2 * HOUR_MS, 24 * HOUR_MS],
      High: [4 * HOUR_MS, 48 * HOUR_MS],
      Medium: [24 * HOUR_MS, 5 * 24 * HOUR_MS],
      Low: [2 * 24 * HOUR_MS, 10 * 24 * HOUR_MS],
    };
    const windows: Record<string, { first: number; resolution: number }> = {};
    for (const priority of Object.keys(expected)) {
      const t = await newTicket({ priority });
      const timers = await slaTimerWindows(t.id);
      windows[priority] = { first: timers.find((x) => x.name === SLA19)?.windowMs ?? -1, resolution: timers.find((x) => x.name === SLA20)?.windowMs ?? -1 };
      expect([windows[priority]?.first, windows[priority]?.resolution], `${priority} targets (first response, resolution)`).toEqual(expected[priority]);
    }
    expect(windows.Critical?.first, "Critical differs from Low").toBeLessThan(windows.Low?.first ?? 0);
    expect(windows.Critical?.resolution, "Critical differs from Low").toBeLessThan(windows.Low?.resolution ?? 0);
  });

  tc("TC-SVC-010", async ({ page }) => {
    const a = await build.asset();
    const other = await build.asset(); // control: another asset / account
    extraAssets.push(a.assetId, other.assetId);
    const own = [(await newTicket({}, a)).id, (await newTicket({ complaintType: "Calibration" }, a)).id];
    const control = (await newTicket({}, other)).id;
    const dir = await director();
    // Asset -> Service history and Account -> Service list exactly this asset's / account's tickets
    const ids = async (path: string): Promise<string[]> => (ok(await dir.get(path), path).body.data ?? []).map((t) => t.id as string).sort();
    expect(await ids(`/modules/assets/${a.assetId}/related/service?limit=100`)).toEqual([...own].sort());
    expect(await ids(`/modules/accounts/${a.account.id}/related/service?limit=100`)).toEqual([...own].sort());
    const assetDetail = new ModuleDetail(page);
    await assetDetail.goto("assets", a.assetId);
    await assetDetail.tab("Service history");
    const rows = page.getByRole("tabpanel").getByRole("row");
    await expect(rows).toHaveCount(3); // header + 2 tickets
    await expect(page.getByRole("tabpanel").getByText(own[0] as string, { exact: false }).first()).toBeVisible();
    await expect(page.getByRole("tabpanel")).not.toContainText(control);
    await page.goto(`/accounts/${a.account.id}`);
    await assetDetail.tab("Service");
    await expect(page.getByRole("tabpanel").getByRole("row")).toHaveCount(3);
    // The Service Manager (the case's role) holds service CRUDE but sees none of them: not her tickets (D-102)
    const sm = await apiAs("serviceManager");
    const seen = ok(await sm.get(`/modules/assets/${a.assetId}/related/service?limit=100`), "Service Manager asset service history").body.data ?? [];
    if (seen.length !== own.length) expect(seen, "current: the Service Manager's service history is empty (remove with D-102)").toEqual([]);
    await knownDefect(test.info(), "D-102", async () => {
      expect(seen.map((t) => t.id as string).sort(), "tickets of the asset as seen by the Service Manager").toEqual([...own].sort());
    });
  });
});

test.describe("Service tickets - Service Engineer", () => {
  test.use({ storageState: authFile("serviceEngineer") });

  tc("TC-SVC-005", async ({ page }) => {
    const t = await ticketAt("Visit scheduled");
    const engineerApi = await apiAs("serviceEngineer");
    const detail = await openTicket(page, t.id);
    expect(await detail.statusText()).toBe("Visit scheduled");
    await detail.action("Start work");
    await expect.poll(() => statusOf(t.id), { message: "status after Start work" }).toBe("In progress");
    // Parts required needs the parts text
    await expectActionRejected(engineerApi, "service", t.id, "Parts required", {}, "'parts' is required to Parts required.");
    expect(await statusOf(t.id)).toBe("In progress");
    await reloaded(page);
    expect(await detail.statusText()).toBe("In progress");
    await detail.action("Parts required");
    await expect(page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true })).toBeDisabled();
    await detail.answerPrompt("Load cell LC-60T, junction box");
    await expect.poll(() => statusOf(t.id), { message: "status after Parts required" }).toBe("Parts required");
    expect((await ticketOf(t.id)).partsRequired).toBe("Load cell LC-60T, junction box");
    await reloaded(page);
    // 'Parts required' is outside the progress flow: no step is current
    expect(await detail.isOutOfFlow()).toBe(true);
    // the Work log tab shows the parts (the field reads registry key `parts`, the record carries `partsRequired`, D-107)
    await detail.tab("Work log");
    await expect(fieldValue(page, "Customer confirmation")).toBeVisible(); // tab loaded
    await knownDefect(test.info(), "D-107", async () => {
      await expect(fieldValue(page, "Parts required")).toHaveText("Load cell LC-60T, junction box", { timeout: 1_000 });
    });
    // Start work is allowed again from Parts required
    await detail.action("Start work");
    await expect.poll(() => statusOf(t.id), { message: "status after the second Start work" }).toBe("In progress");
  });

  tc("TC-SVC-006", async ({ page }) => {
    const t = await ticketAt("In progress");
    const engineerApi = await apiAs("serviceEngineer");
    await expectActionRejected(engineerApi, "service", t.id, "Resolve", {}, "'resolution' is required to Resolve.");
    await expectActionRejected(engineerApi, "service", t.id, "Resolve", { resolution: "" }, "'resolution' is required to Resolve.");
    expect(await statusOf(t.id)).toBe("In progress");
    expect((await slaTimerWindows(t.id)).find((x) => x.name === SLA20)?.open, "SLA-20 running before Resolve").toBe(true);
    const detail = await openTicket(page, t.id);
    expect(await detail.statusText()).toBe("In progress");
    await detail.action("Resolve");
    await expect(page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true })).toBeDisabled();
    await detail.answerPrompt("Replaced the load cell and recalibrated");
    await expect.poll(() => statusOf(t.id), { message: "status after Resolve" }).toBe("Resolved");
    expect((await ticketOf(t.id)).resolution).toBe("Replaced the load cell and recalibrated");
    expect((await slaTimerWindows(t.id)).find((x) => x.name === SLA20)?.open, "SLA-20 stopped on resolve").toBe(false);
    await reloaded(page);
    expect(await detail.statusText()).toBe("Resolved");
    await expect(stepLabel(page)).toHaveText("Resolved");
  });
});
