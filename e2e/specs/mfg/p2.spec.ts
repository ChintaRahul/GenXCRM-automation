// e2e/specs/mfg/p2.spec.ts - Phase-2 scope (TC-P2-001..005). 001-004 are known GAPS (dealer / tender / ERP / telephony+calendar): bodies assert the
// SPECIFIED behaviour (tc() wraps them in test.fail); setup and preconditions use plain-Error helpers, only the final spec-correct check is an expect().
// 005 (competitor master & notes on lost deals) is Partial: it asserts what exists and records the missing fields as a known defect.
import { expect, test } from "@playwright/test";
import { authFile } from "../../fixtures/mfgUsers";
import { ModuleDetail } from "../../pages/mfg/ModuleDetail";
import { apiAs, ApiClient, build, ok, type ApiResult } from "../../mfg/api";
import { tc } from "../../mfg/caseTest";
import { knownDefect } from "../../mfg/guards";
import { uniqueTag } from "../../mfg/tag";

/** Precondition: the role can read a module that exists, so a failing gap check is not a broken login. */
const requireReadable = async (api: ApiClient, key: string): Promise<void> => {
  const r = await api.get(`/modules/${key}?limit=1`);
  if (r.status !== 200) throw new Error(`precondition: GET /modules/${key} should be 200 (got ${r.status} ${ApiClient.message(r)})`);
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

test.describe("P2 - Sales Head", () => {
  test.use({ storageState: authFile("salesHead") });

  tc("TC-P2-001", async () => {
    const api = await apiAs("salesHead");
    await requireReadable(api, "accounts");
    const [dealers, partners]: ApiResult[] = [await api.get("/modules/dealers?limit=1"), await api.get("/modules/partners?limit=1")];
    // Spec: a partner master (dealers / channel partners) exists.
    expect([dealers.status, partners.status].includes(200), `partner master module (dealers ${dealers.status}, partners ${partners.status})`).toBe(true);
  });

  tc("TC-P2-002", async () => {
    const api = await apiAs("salesHead");
    await requireReadable(api, "accounts");
    const tenders = await api.get("/modules/tenders?limit=1");
    // Spec: a Tender entity (deadlines, EMD, checklist) exists.
    expect(tenders.status, "GET /modules/tenders").toBe(200);
  });
});

test.describe("P2 - Super Admin", () => {
  test.use({ storageState: authFile("superAdmin") });

  tc("TC-P2-003", async () => {
    const api = await apiAs("superAdmin");
    await requireReadable(api, "accounts");
    const erp = await api.get("/modules/erp?limit=1");
    // Spec: an ERP / accounting connector (customer code, item master, order / dispatch / invoice / receipt sync) is configurable.
    expect(erp.status, "GET /modules/erp").toBe(200);
  });

  tc("TC-P2-004", async ({ page }) => {
    const api = await apiAs("superAdmin");
    await requireReadable(api, "contacts");
    const account = await build.account(api);
    const contact = await build.contact(api, account.id);
    try {
      // Page-ready precondition (plain Error): the contact detail must be loaded before it is inspected.
      await page.goto(`/contacts/${contact.id}`);
      try {
        await page.getByRole("button", { name: "More actions", exact: true }).waitFor({ timeout: 15_000 });
      } catch {
        throw new Error("precondition: the contact detail page did not load");
      }
      // A real click-to-call control: a tel: link, or a control named click-to-call / dial (NOT the activity 'Log call' button).
      const clickToCall = (await page.locator('a[href^="tel:"]').count()) + (await page.getByRole("button", { name: /click.?to.?call|dial/i }).count()) > 0;
      const calendar = await api.get("/modules/calendar?limit=1");
      // Spec: click-to-call on a record and a calendar sync connection.
      expect({ clickToCall, calendarSync: calendar.status === 200 }).toEqual({ clickToCall: true, calendarSync: true });
    } finally {
      await archiveQuietly("contacts", [contact.id]);
      await archiveQuietly("accounts", [account.id]);
    }
  });
});

test.describe("P2 - Sales Manager", () => {
  test.use({ storageState: authFile("salesManager") });

  tc("TC-P2-005", async ({ page }, testInfo) => {
    test.slow();
    const api = await apiAs("salesManager");
    const account = await build.account(api);
    const opp = await build.opportunity(api, account.id, { title: `${uniqueTag("P2")} competitive deal`, competitor: "Mettler Toledo" });
    try {
      // Mark lost with a competitor deal: the reason prompt is the only mandatory input.
      const detail = new ModuleDetail(page);
      await detail.goto("opps", opp.id);
      await detail.action("Mark lost");
      await detail.answerPrompt("Competitor");
      await expect.poll(async () => (await api.get(`/modules/opps/${opp.id}`)).body.stage, { message: "the deal is Lost", timeout: 15_000 }).toBe("Lost");
      await detail.expectNoAction("Mark lost");
      const record = ok(await api.get(`/modules/opps/${opp.id}`), "read lost deal").body;
      expect(record).toMatchObject({ stage: "Lost", lostReason: "Competitor", competitor: "Mettler Toledo" });

      // Spec: competitor price, competitor product, decision date and feedback are captured. Only the competitor (a master-backed select) exists.
      const main = page.getByRole("main");
      await expect(main.getByText("Competitor", { exact: true }).first()).toBeVisible();
      const text = await main.innerText();
      const missing = ["Competitor price", "Competitor product", "Decision date", "Feedback"].filter((l) => !new RegExp(l, "i").test(text));
      await knownDefect(testInfo, "D-131", async () => {
        expect(missing, "spec fields missing on the lost deal").toEqual([]);
      });
      const api400 = await api.patch(`/modules/opps/${opp.id}`, { competitorPrice: 1 });
      expect(api400.status, "current: the API has no competitor price field (remove with D-131)").toBe(400);
    } finally {
      await archiveQuietly("opps", [opp.id]);
      await archiveQuietly("accounts", [account.id]);
    }
  });
});
