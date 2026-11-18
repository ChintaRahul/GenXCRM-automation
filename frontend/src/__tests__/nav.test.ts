import { describe, it, expect } from "vitest";
import { NAV, filterNavByReadable } from "../config/nav";

describe("NAV config", () => {
  it("EDTECH has the 3 pinned items and 4 groups from the spec", () => {
    expect(NAV.EDTECH.pinned.map((i) => i.label)).toEqual([
      "Dashboard",
      "Leads",
      "Reports",
    ]);
    expect(NAV.EDTECH.groups.map((g) => g.key)).toEqual([
      "enrolment",
      "finance",
      "engage",
      "workspace",
    ]);
  });

  it("EDTECH's workspace group keeps the existing role gates", () => {
    const workspace = NAV.EDTECH.groups.find((g) => g.key === "workspace")!;
    const byLabel = Object.fromEntries(workspace.items.map((i) => [i.label, i.roles]));
    expect(byLabel["Team"]).toEqual(["DIRECTOR", "MANAGER"]);
    expect(byLabel["Integrations"]).toEqual(["DIRECTOR", "MANAGER"]);
    expect(byLabel["Billing"]).toEqual(["DIRECTOR"]);
    expect(byLabel["Administration"]).toEqual(["DIRECTOR", "MANAGER"]);
  });

  it("MANUFACTURING has the 3 pinned items and 8 groups (spec groups plus Channel & tenders)", () => {
    expect(NAV.MANUFACTURING.pinned.map((i) => i.label)).toEqual([
      "Dashboard",
      "Leads",
      "Reports",
    ]);
    expect(NAV.MANUFACTURING.groups.map((g) => g.key)).toEqual([
      "customers",
      "deals",
      "quoting",
      "orders",
      "channel",
      "aftersales",
      "engage",
      "workspace",
    ]);
  });

  it("MANUFACTURING route slugs match the plan's exact list", () => {
    const allItems = NAV.MANUFACTURING.groups.flatMap((g) => g.items);
    const byLabel = Object.fromEntries(allItems.map((i) => [i.label, i.to]));
    expect(byLabel["Accounts"]).toBe("/accounts");
    expect(byLabel["Contacts"]).toBe("/contacts");
    expect(byLabel["Activities"]).toBe("/activities");
    expect(byLabel["Opportunities"]).toBe("/opportunities");
    expect(byLabel["RFQs"]).toBe("/rfqs");
    expect(byLabel["Site visits"]).toBe("/site-visits");
    expect(byLabel["Demos & trials"]).toBe("/demos");
    expect(byLabel["Products"]).toBe("/products");
    expect(byLabel["Costing"]).toBe("/costing");
    expect(byLabel["Quotations"]).toBe("/quotations");
    expect(byLabel["Approvals"]).toBe("/approvals");
    expect(byLabel["Purchase orders"]).toBe("/purchase-orders");
    expect(byLabel["Sales orders"]).toBe("/sales-orders");
    expect(byLabel["Dispatch"]).toBe("/dispatch");
    expect(byLabel["Payments"]).toBe("/payments");
    expect(byLabel["Installed assets"]).toBe("/installed-assets");
    expect(byLabel["AMC & warranty"]).toBe("/amc");
    expect(byLabel["Service tickets"]).toBe("/service-tickets");
  });

  it("Approvals and Service tickets have no badge in this phase", () => {
    const allItems = NAV.MANUFACTURING.groups.flatMap((g) => g.items);
    const approvals = allItems.find((i) => i.label === "Approvals")!;
    const service = allItems.find((i) => i.label === "Service tickets")!;
    expect(approvals.badge).toBeUndefined();
    expect(service.badge).toBeUndefined();
  });

  it("Manufacturing's Templates has the same role gate as EdTech's (same page, same sensitivity)", () => {
    const edtechTemplates = NAV.EDTECH.groups.flatMap((g) => g.items).find((i) => i.label === "Templates");
    const mfgTemplates = NAV.MANUFACTURING.groups.flatMap((g) => g.items).find((i) => i.label === "Templates");
    expect(mfgTemplates?.roles).toEqual(["DIRECTOR", "MANAGER"]);
    expect(mfgTemplates?.roles).toEqual(edtechTemplates?.roles);
  });

  it("filterNavByReadable hides unreadable module links and keeps non-module links", () => {
    const { pinned, groups } = NAV.MANUFACTURING;
    const result = filterNavByReadable(pinned, groups, ["leads", "quotes"]);
    const labels = result.groups.flatMap((g) => g.items.map((i) => i.label));
    expect(labels).toContain("Quotations");
    expect(labels).not.toContain("Costing");
    expect(result.pinned.map((i) => i.label)).toContain("Dashboard");
    expect(result.groups.every((g) => g.items.length > 0)).toBe(true);
  });

  it("filterNavByReadable is a no-op when unrestricted (null)", () => {
    const { pinned, groups } = NAV.MANUFACTURING;
    expect(filterNavByReadable(pinned, groups, null)).toEqual({ pinned, groups });
  });

  it("the Leads pinned item has no roles restriction, for both workspace types", () => {
    expect(NAV.EDTECH.pinned.find((i) => i.label === "Leads")?.roles).toBeUndefined();
    expect(NAV.MANUFACTURING.pinned.find((i) => i.label === "Leads")?.roles).toBeUndefined();
  });
});
