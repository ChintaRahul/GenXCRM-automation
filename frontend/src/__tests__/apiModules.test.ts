import { describe, it, expect, vi, beforeEach } from "vitest";
import api from "../api/client";
import {
  getModuleList, getModuleRecord, createModuleRecord, updateModuleRecord,
  performModuleAction, archiveModuleRecord, getModuleRelated,
  getModuleTable, getModuleEvents, getModuleDocuments, getModuleAudit,
  getColumnPrefs, saveColumnPrefs, listModuleViews, saveModuleView, deleteModuleView, getModuleFacets,
  exportModuleList,
} from "../api/modules";

vi.mock("../api/client", () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

describe("api/modules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getModuleList calls GET /modules/:key with query params", async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { data: [], total: 0, page: 1, limit: 20, pages: 0 } });
    await getModuleList("accounts", { page: 1, limit: 20, search: "acme" });
    expect(api.get).toHaveBeenCalledWith("/modules/accounts", { params: { page: 1, limit: 20, search: "acme" } });
  });

  it("getModuleRecord calls GET /modules/:key/:id", async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { id: "A-1" } });
    const result = await getModuleRecord("accounts", "A-1");
    expect(api.get).toHaveBeenCalledWith("/modules/accounts/A-1");
    expect(result).toEqual({ id: "A-1" });
  });

  it("createModuleRecord calls POST /modules/:key with the body", async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { id: "A-2" } });
    await createModuleRecord("accounts", { name: "Acme" });
    expect(api.post).toHaveBeenCalledWith("/modules/accounts", { name: "Acme" });
  });

  it("updateModuleRecord calls PATCH /modules/:key/:id with the body", async () => {
    vi.mocked(api.patch).mockResolvedValue({ data: { id: "A-1" } });
    await updateModuleRecord("accounts", "A-1", { name: "Acme Renamed" });
    expect(api.patch).toHaveBeenCalledWith("/modules/accounts/A-1", { name: "Acme Renamed" });
  });

  it("performModuleAction calls POST /modules/:key/:id/actions with action + payload", async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { id: "LD-1", status: "Qualified" } });
    await performModuleAction("leads", "LD-1", "Qualify");
    expect(api.post).toHaveBeenCalledWith("/modules/leads/LD-1/actions", { action: "Qualify" });
  });

  it("performModuleAction includes ask-field payload when provided", async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { id: "LD-1", status: "Disqualified" } });
    await performModuleAction("leads", "LD-1", "Disqualify", { disq: "Budget" });
    expect(api.post).toHaveBeenCalledWith("/modules/leads/LD-1/actions", { action: "Disqualify", disq: "Budget" });
  });

  it("archiveModuleRecord calls POST /modules/:key/:id/archive", async () => {
    vi.mocked(api.post).mockResolvedValue({ data: {} });
    await archiveModuleRecord("accounts", "A-1");
    expect(api.post).toHaveBeenCalledWith("/modules/accounts/A-1/archive");
  });

  it("getModuleRelated calls GET /modules/:key/:id/related/:tabKey with pagination params", async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { data: [], total: 0, page: 1, limit: 10, pages: 0 } });
    await getModuleRelated("accounts", "A-1", "contacts", { page: 1, limit: 10 });
    expect(api.get).toHaveBeenCalledWith("/modules/accounts/A-1/related/contacts", { params: { page: 1, limit: 10 } });
  });

  it("getModuleTable calls GET /modules/:key/:id/table/:tabKey", async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { columns: [], rows: [] } });
    const result = await getModuleTable("accounts", "A-1", "plants");
    expect(api.get).toHaveBeenCalledWith("/modules/accounts/A-1/table/plants");
    expect(result).toEqual({ columns: [], rows: [] });
  });

  it("getModuleEvents calls GET /modules/:key/:id/events/:tabKey", async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [] });
    await getModuleEvents("opps", "OP-1", "history");
    expect(api.get).toHaveBeenCalledWith("/modules/opps/OP-1/events/history");
  });

  it("getModuleDocuments calls GET /modules/:key/:id/documents", async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [] });
    await getModuleDocuments("rfqs", "RFQ-1");
    expect(api.get).toHaveBeenCalledWith("/modules/rfqs/RFQ-1/documents");
  });

  it("getModuleAudit calls GET /modules/:key/:id/audit", async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [] });
    await getModuleAudit("accounts", "A-1");
    expect(api.get).toHaveBeenCalledWith("/modules/accounts/A-1/audit");
  });

  it("getColumnPrefs calls GET /modules/:key/column-prefs", async () => {
    vi.mocked(api.get).mockResolvedValue({ data: null });
    const result = await getColumnPrefs("accounts");
    expect(api.get).toHaveBeenCalledWith("/modules/accounts/column-prefs");
    expect(result).toBeNull();
  });

  it("getColumnPrefs treats an empty response body as no saved preference (not as zero columns)", async () => {
    vi.mocked(api.get).mockResolvedValue({ data: "" });
    expect(await getColumnPrefs("accounts")).toBeNull();
  });

  it("getColumnPrefs returns a saved list as-is, including a deliberately empty one", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ data: ["name", "owner"] });
    expect(await getColumnPrefs("accounts")).toEqual(["name", "owner"]);
    vi.mocked(api.get).mockResolvedValueOnce({ data: [] });
    expect(await getColumnPrefs("accounts")).toEqual([]);
  });

  it("saveColumnPrefs calls PUT /modules/:key/column-prefs with the keys", async () => {
    vi.mocked(api.put).mockResolvedValue({ data: undefined });
    await saveColumnPrefs("accounts", ["id", "name"]);
    expect(api.put).toHaveBeenCalledWith("/modules/accounts/column-prefs", { keys: ["id", "name"] });
  });

  it("listModuleViews calls GET /modules/:key/views", async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [] });
    await listModuleViews("accounts");
    expect(api.get).toHaveBeenCalledWith("/modules/accounts/views");
  });

  it("saveModuleView calls POST /modules/:key/views with name and filters", async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { id: "v1", name: "Big", filters: {} } });
    await saveModuleView("accounts", { name: "Big", filters: { slaRisk: true } });
    expect(api.post).toHaveBeenCalledWith("/modules/accounts/views", { name: "Big", filters: { slaRisk: true } });
  });

  it("deleteModuleView calls DELETE /modules/:key/views/:id", async () => {
    vi.mocked(api.delete).mockResolvedValue({ data: undefined });
    await deleteModuleView("accounts", "v1");
    expect(api.delete).toHaveBeenCalledWith("/modules/accounts/views/v1");
  });

  it("getModuleFacets calls GET /modules/:key/facets with the search term", async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { total: 0 } });
    await getModuleFacets("accounts", { search: "acme" });
    expect(api.get).toHaveBeenCalledWith("/modules/accounts/facets", { params: { search: "acme" } });
  });

  it("exportModuleList calls GET /modules/:key/export as a blob with the list params", async () => {
    const blob = new Blob(["csv"]);
    vi.mocked(api.get).mockResolvedValue({ data: blob });
    const result = await exportModuleList("accounts", { page: 1, limit: 20, search: "acme" });
    expect(api.get).toHaveBeenCalledWith("/modules/accounts/export", {
      params: { page: 1, limit: 20, search: "acme" },
      responseType: "blob",
    });
    expect(result).toBe(blob);
  });
});
