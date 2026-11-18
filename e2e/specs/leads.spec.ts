import { test, expect } from "../fixtures/test";
import { LeadsPage } from "../pages/LeadsPage";
import { LeadDetailPage } from "../pages/LeadDetailPage";

function uniqueLeadName(prefix: string): string {
  return `${prefix} E2E ${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

// Phone/email must be unique per run too — the backend dedups leads by phone OR email
// (see CLAUDE.md "Lead Deduplication"), so a hardcoded value would collide with leads
// left over from earlier test runs (this suite doesn't reset the E2E DB between runs).
// Frontend requires exactly 10 digits (see getPhoneError in Leads.tsx) — no country code.
let uniqueSeq = 0;
function uniquePhone(): string {
  uniqueSeq += 1;
  return `9${Date.now().toString().slice(-8)}${uniqueSeq % 10}`;
}
function uniqueEmail(tag: string): string {
  return `e2e.${tag}.${Date.now()}@genxcrm-e2e.example`;
}

test.describe("Leads — Sales Rep", () => {
  test.use({ storageState: ".auth/salesRep.json" });

  test("creates a lead, views its detail, changes stage, and adds a note", async ({ page }) => {
    const leadName = uniqueLeadName("Rep");
    const leadsPage = new LeadsPage(page);
    await leadsPage.goto();

    const leadId = await leadsPage.createLead({
      name: leadName,
      phone: uniquePhone(),
      email: uniqueEmail("lead1"),
      source: "WALK IN",
    });

    // A newly-created lead starts unassigned; round-robin assignment runs async via
    // BullMQ and the sales rep's list is filtered to assignedToId, and the list
    // doesn't live-refresh once assignment settles — poll for it instead.
    await leadsPage.waitForLeadAssigned(leadId);
    await expect(leadsPage.viewLeadLink(leadName)).toBeVisible();

    await leadsPage.openLead(leadName);
    await expect(page).toHaveURL(/\/leads\/[\w-]+/);

    const leadDetail = new LeadDetailPage(page);
    await leadDetail.markEnrolled();
    await expect(leadDetail.markEnrolledButton).toBeDisabled();

    await leadDetail.addNote("First contact made via E2E test.");
    await expect(page.getByText("First contact made via E2E test.")).toBeVisible();
  });
});

test.describe("Leads — hierarchy visibility", () => {
  test("a lead created by a sales rep is visible to the director", async ({ browser }) => {
    const leadName = uniqueLeadName("Hierarchy");

    const repContext = await browser.newContext({ storageState: ".auth/salesRep.json" });
    const repPage = await repContext.newPage();
    const repLeadsPage = new LeadsPage(repPage);
    await repLeadsPage.goto();
    const leadId = await repLeadsPage.createLead({
      name: leadName,
      phone: uniquePhone(),
      email: uniqueEmail("lead2"),
      source: "WALK IN",
    });
    await repLeadsPage.waitForLeadAssigned(leadId);
    await expect(repLeadsPage.viewLeadLink(leadName)).toBeVisible();
    await repContext.close();

    const directorContext = await browser.newContext({ storageState: ".auth/director.json" });
    const directorPage = await directorContext.newPage();
    const directorLeadsPage = new LeadsPage(directorPage);
    await directorLeadsPage.goto();
    await directorLeadsPage.search(leadName);
    await expect(directorLeadsPage.viewLeadLink(leadName)).toBeVisible();
    await directorContext.close();
  });
});
