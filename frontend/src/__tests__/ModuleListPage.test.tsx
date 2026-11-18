import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ModuleListPage } from "../components/module/ModuleListPage";
import * as modulesApi from "../api/modules";
import * as authCtx from "../context/AuthContext";

vi.mock("../api/modules");
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
// Header (rendered by ModuleListPage) calls useAuth() with no fallback context value,
// so it throws when mounted outside an <AuthProvider> — same mocking pattern already
// used by LeadDetail.test.tsx and other page-level tests in this suite.
vi.mock("../context/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("../components/module/ModuleBoard", () => ({
  ModuleBoard: () => <div data-testid="module-board" />,
}));

const accountRecord = { id: "A-1021", short: "Kaveri Steel", industry: "Steel & metals", type: "Customer", territory: "South", potential: 5000000, ownerId: "ad", status: "Active" };

const accountFacets: modulesApi.ModuleFacets = {
  total: 1,
  status: { Active: 1 },
  owners: [{ id: "u-ad", name: "Asha D", count: 1 }],
  facets: { industry: { "Steel & metals": 1 }, type: { Customer: 1 } },
  slaRiskCount: 0,
  capabilities: { owner: true, date: true, value: true, sla: false },
};

const openFilters = async () => {
  fireEvent.click(await screen.findByRole("button", { name: /^filters/i }));
  return screen.findByRole("dialog");
};

describe("ModuleListPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authCtx.useAuth).mockReturnValue({
      user: { id: "u1", name: "Test User", email: "test@example.com", role: "SALES_REP", teamId: null },
      token: "tok",
      loading: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
      updateUser: vi.fn(),
      isImpersonating: false,
      impersonate: vi.fn(),
      exitImpersonation: vi.fn(),
    });
    vi.mocked(modulesApi.getModuleList).mockResolvedValue({
      data: [accountRecord], total: 1, page: 1, limit: 20, pages: 1,
    });
    vi.mocked(modulesApi.getColumnPrefs).mockResolvedValue(null);
    vi.mocked(modulesApi.saveColumnPrefs).mockResolvedValue(undefined);
    vi.mocked(modulesApi.getModuleFacets).mockResolvedValue(accountFacets);
    vi.mocked(modulesApi.listModuleViews).mockResolvedValue([]);
  });

  it("renders the module's title and the fetched records in the table", async () => {
    render(
      <MemoryRouter>
        <ModuleListPage moduleKey="accounts" onRowClick={vi.fn()} />
      </MemoryRouter>,
    );
    expect(await screen.findByText("Accounts")).toBeInTheDocument();
    expect(await screen.findByText("Kaveri Steel")).toBeInTheDocument();
  });

  it("calls onRowClick with the record when a row is clicked", async () => {
    const onRowClick = vi.fn();
    render(
      <MemoryRouter>
        <ModuleListPage moduleKey="accounts" onRowClick={onRowClick} />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByText("Kaveri Steel"));
    expect(onRowClick).toHaveBeenCalledWith(expect.objectContaining({ id: "A-1021" }));
  });

  it("debounced search calls getModuleList with the search term", async () => {
    render(
      <MemoryRouter>
        <ModuleListPage moduleKey="accounts" onRowClick={vi.fn()} />
      </MemoryRouter>,
    );
    await screen.findByText("Kaveri Steel");
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "kaveri" } });
    await waitFor(() =>
      expect(modulesApi.getModuleList).toHaveBeenLastCalledWith("accounts", expect.objectContaining({ search: "kaveri" })),
      { timeout: 2000 },
    );
  });

  it("shows status chips derived from the registry's statuses, and filtering by one calls the API with that status", async () => {
    render(
      <MemoryRouter>
        <ModuleListPage moduleKey="accounts" onRowClick={vi.fn()} />
      </MemoryRouter>,
    );
    await screen.findByText("Kaveri Steel");
    fireEvent.click(screen.getByRole("button", { name: /active/i }));
    await waitFor(() =>
      expect(modulesApi.getModuleList).toHaveBeenLastCalledWith("accounts", expect.objectContaining({ status: ["Active"] })),
    );
  });

  it("says there are none yet when the list is empty and unfiltered", async () => {
    vi.mocked(modulesApi.getModuleList).mockResolvedValue({ data: [], total: 0, page: 1, limit: 20, pages: 0 });
    render(
      <MemoryRouter>
        <ModuleListPage moduleKey="accounts" onRowClick={vi.fn()} />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/no accounts yet/i)).toBeInTheDocument();
  });

  it("shows a New button when onNew is provided, and hides it when the module has noCreate", async () => {
    const { rerender } = render(
      <MemoryRouter>
        <ModuleListPage moduleKey="accounts" onRowClick={vi.fn()} onNew={vi.fn()} />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("button", { name: /new account/i })).toBeInTheDocument();

    vi.mocked(modulesApi.getModuleList).mockResolvedValue({ data: [], total: 0, page: 1, limit: 20, pages: 0 });
    rerender(
      <MemoryRouter>
        <ModuleListPage moduleKey="billing" onRowClick={vi.fn()} onNew={vi.fn()} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.queryByRole("button", { name: /new invoice/i })).not.toBeInTheDocument());
  });

  it("shows an error message instead of the empty state when the fetch fails", async () => {
    vi.mocked(modulesApi.getModuleList).mockRejectedValue(new Error("Network error"));
    render(
      <MemoryRouter>
        <ModuleListPage moduleKey="accounts" onRowClick={vi.fn()} />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/couldn.t load accounts/i)).toBeInTheDocument();
  });

  it("shows a friendly no-access message when the list fetch is forbidden (403)", async () => {
    const forbidden = Object.assign(new Error("Request failed with status code 403"), {
      isAxiosError: true,
      response: { status: 403 },
    });
    vi.mocked(modulesApi.getModuleList).mockRejectedValue(forbidden);
    render(
      <MemoryRouter>
        <ModuleListPage moduleKey="costing" onRowClick={vi.fn()} />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/don.t have access to costing/i)).toBeInTheDocument();
    expect(screen.queryByText(/couldn.t load costing/i)).not.toBeInTheDocument();
  });

  it("shows a restricted banner instead of the list for a restricted module without access", async () => {
    render(
      <MemoryRouter>
        <ModuleListPage moduleKey="costing" onRowClick={vi.fn()} hasModuleAccess={false} />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/costing is restricted/i)).toBeInTheDocument();
  });

  it("derives status chip counts from the facets endpoint for a non-default statusKey (opps uses 'stage')", async () => {
    vi.mocked(modulesApi.getModuleFacets).mockResolvedValue({ ...accountFacets, status: { Won: 1 } });
    vi.mocked(modulesApi.getModuleList).mockResolvedValue({
      data: [{ id: "OP-1", title: "Deal", acc: "A-1", stage: "Won" }],
      total: 1, page: 1, limit: 20, pages: 1,
    });
    render(
      <MemoryRouter>
        <ModuleListPage moduleKey="opps" onRowClick={vi.fn()} />
      </MemoryRouter>,
    );
    await screen.findByText("Deal");
    expect(screen.getByRole("button", { name: /^won \(1\)/i })).toBeInTheDocument();
  });

  it("picks an owner in the Filters drawer and fetches the list with that ownerId, showing a removable chip", async () => {
    render(
      <MemoryRouter>
        <ModuleListPage moduleKey="accounts" onRowClick={vi.fn()} />
      </MemoryRouter>,
    );
    await screen.findByText("Kaveri Steel");
    const drawer = await openFilters();
    fireEvent.click(within(drawer).getByRole("checkbox", { name: /asha d/i }));
    await waitFor(() =>
      expect(modulesApi.getModuleList).toHaveBeenLastCalledWith("accounts", expect.objectContaining({ ownerId: ["u-ad"] })),
    );
    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
    fireEvent.click(await screen.findByLabelText("Remove filter Asha D"));
    await waitFor(() =>
      expect(modulesApi.getModuleList).toHaveBeenLastCalledWith("accounts", expect.objectContaining({ ownerId: undefined })),
    );
  });

  it("sends module facet selections as a JSON facets param and counts chips per value", async () => {
    render(
      <MemoryRouter>
        <ModuleListPage moduleKey="accounts" onRowClick={vi.fn()} />
      </MemoryRouter>,
    );
    await screen.findByText("Kaveri Steel");
    const drawer = await openFilters();
    fireEvent.click(within(drawer).getByRole("checkbox", { name: /customer/i }));
    await waitFor(() =>
      expect(modulesApi.getModuleList).toHaveBeenLastCalledWith(
        "accounts",
        expect.objectContaining({ facets: JSON.stringify({ type: ["Customer"] }) }),
      ),
    );
    expect(screen.getByRole("button", { name: /^filters\s*1$/i, hidden: true })).toBeInTheDocument();
  });

  it("hides the Owner section when the backend reports no owner capability (own-scope role)", async () => {
    vi.mocked(modulesApi.getModuleFacets).mockResolvedValue({ ...accountFacets, owners: [], capabilities: { ...accountFacets.capabilities, owner: false } });
    render(
      <MemoryRouter>
        <ModuleListPage moduleKey="accounts" onRowClick={vi.fn()} />
      </MemoryRouter>,
    );
    await screen.findByText("Kaveri Steel");
    const drawer = await openFilters();
    expect(within(drawer).queryByText("Owner")).not.toBeInTheDocument();
  });

  it("has no Filters button for a module whose backend has no filters", async () => {
    vi.mocked(modulesApi.getModuleFacets).mockRejectedValue(new Error("404"));
    render(
      <MemoryRouter>
        <ModuleListPage moduleKey="accounts" onRowClick={vi.fn()} />
      </MemoryRouter>,
    );
    await screen.findByText("Kaveri Steel");
    expect(screen.queryByRole("button", { name: /^filters/i })).not.toBeInTheDocument();
  });

  it("renders the list as cards (no table) below 800px and opens the record when a card is tapped", async () => {
    const prevWidth = window.innerWidth;
    window.innerWidth = 600;
    try {
      const onRowClick = vi.fn();
      render(
        <MemoryRouter>
          <ModuleListPage moduleKey="accounts" onRowClick={onRowClick} />
        </MemoryRouter>,
      );
      const card = await screen.findByRole("button", { name: /kaveri steel/i });
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
      fireEvent.click(card);
      expect(onRowClick).toHaveBeenCalledWith(accountRecord);
    } finally {
      window.innerWidth = prevWidth;
    }
  });

  it("shows the List/Board toggle only for a kanban module", async () => {
    const { rerender } = render(
      <MemoryRouter>
        <ModuleListPage moduleKey="opps" onRowClick={vi.fn()} />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("button", { name: /^board$/i })).toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <ModuleListPage moduleKey="accounts" onRowClick={vi.fn()} />
      </MemoryRouter>,
    );
    await screen.findByText("Kaveri Steel");
    expect(screen.queryByRole("button", { name: /^board$/i })).not.toBeInTheDocument();
  });

  it("switches to ModuleBoard when Board is selected, and back to the table when List is selected again", async () => {
    render(
      <MemoryRouter>
        <ModuleListPage moduleKey="opps" onRowClick={vi.fn()} />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole("button", { name: /^board$/i }));
    expect(await screen.findByTestId("module-board")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^list$/i }));
    await waitFor(() => expect(screen.queryByTestId("module-board")).not.toBeInTheDocument());
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("keeps search and filters in Board view, hiding only the column chooser", async () => {
    render(
      <MemoryRouter>
        <ModuleListPage moduleKey="opps" onRowClick={vi.fn()} />
      </MemoryRouter>,
    );
    await screen.findByRole("button", { name: /^board$/i });
    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^filters/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /choose columns/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^board$/i }));
    await screen.findByTestId("module-board");

    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^filters/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /choose columns/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /export/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^list$/i })).toBeInTheDocument();
  });

  it("hides a column from both header and rows when toggled off", async () => {
    vi.mocked(modulesApi.getColumnPrefs).mockResolvedValue(null);
    render(
      <MemoryRouter>
        <ModuleListPage moduleKey="accounts" onRowClick={vi.fn()} />
      </MemoryRouter>,
    );
    await screen.findByText("Kaveri Steel");
    expect(screen.getByText("Industry")).toBeInTheDocument(); // accounts.cols includes an Industry column

    fireEvent.click(screen.getByRole("button", { name: /choose columns/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /industry/i }));

    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
    await waitFor(() => expect(screen.queryByText("Industry")).not.toBeInTheDocument());
    expect(screen.queryByText("Steel & metals")).not.toBeInTheDocument(); // accountRecord.industry cell
  });

  it("applying a saved view replaces the filters and a second click clears them", async () => {
    vi.mocked(modulesApi.listModuleViews).mockResolvedValue([{ id: "v1", name: "Big deals", filters: { status: ["Active"] } }]);
    render(
      <MemoryRouter>
        <ModuleListPage moduleKey="accounts" onRowClick={vi.fn()} />
      </MemoryRouter>,
    );
    await screen.findByText("Kaveri Steel");
    const drawer = await openFilters();
    fireEvent.click(await within(drawer).findByRole("button", { name: "Big deals" }));
    await waitFor(() =>
      expect(modulesApi.getModuleList).toHaveBeenLastCalledWith("accounts", expect.objectContaining({ status: ["Active"] })),
    );
    fireEvent.click(within(drawer).getByRole("button", { name: "Big deals" }));
    await waitFor(() =>
      expect(modulesApi.getModuleList).toHaveBeenLastCalledWith("accounts", expect.objectContaining({ status: undefined })),
    );
  });

  it("Save current asks for a name and persists the current filters as the user's view", async () => {
    vi.mocked(modulesApi.listModuleViews).mockResolvedValue([]);
    vi.mocked(modulesApi.saveModuleView).mockResolvedValue({ id: "v2", name: "My view", filters: {} });
    render(
      <MemoryRouter>
        <ModuleListPage moduleKey="accounts" onRowClick={vi.fn()} />
      </MemoryRouter>,
    );
    await screen.findByText("Kaveri Steel");
    fireEvent.click(screen.getByRole("button", { name: /active/i })); // quick status chip
    await waitFor(() => expect(modulesApi.getModuleList).toHaveBeenLastCalledWith("accounts", expect.objectContaining({ status: ["Active"] })));
    const drawer = await openFilters();
    fireEvent.click(await within(drawer).findByRole("button", { name: /save current/i }));
    fireEvent.change(within(drawer).getByLabelText("View name"), { target: { value: "My view" } });
    fireEvent.click(within(drawer).getByRole("button", { name: /^save$/i }));
    await waitFor(() =>
      expect(modulesApi.saveModuleView).toHaveBeenCalledWith(
        "accounts",
        expect.objectContaining({ name: "My view", filters: expect.objectContaining({ status: ["Active"] }) }),
      ),
    );
  });

  it("shows a toast and does not crash when saving a view fails", async () => {
    const { toast } = await import("sonner");
    vi.mocked(modulesApi.saveModuleView).mockRejectedValue(new Error("boom"));
    render(
      <MemoryRouter>
        <ModuleListPage moduleKey="accounts" onRowClick={vi.fn()} />
      </MemoryRouter>,
    );
    await screen.findByText("Kaveri Steel");
    fireEvent.click(screen.getByRole("button", { name: /active/i }));
    const drawer = await openFilters();
    fireEvent.click(await within(drawer).findByRole("button", { name: /save current/i }));
    fireEvent.change(within(drawer).getByLabelText("View name"), { target: { value: "My view" } });
    fireEvent.click(within(drawer).getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Couldn't save that view."));
  });

  it("clicking a column header sorts the list by that column, ascending then descending", async () => {
    render(
      <MemoryRouter>
        <ModuleListPage moduleKey="accounts" onRowClick={vi.fn()} />
      </MemoryRouter>,
    );
    await screen.findByText("Kaveri Steel");
    fireEvent.click(screen.getByText((content, element) => element?.tagName.toLowerCase() === "th" && content.includes("Account"))); // accounts.cols' "short" column, labeled "Account"
    await waitFor(() =>
      expect(modulesApi.getModuleList).toHaveBeenLastCalledWith("accounts", expect.objectContaining({ sort: "short" })),
    );
    fireEvent.click(screen.getByText((content, element) => element?.tagName.toLowerCase() === "th" && content.includes("Account")));
    await waitFor(() =>
      expect(modulesApi.getModuleList).toHaveBeenLastCalledWith("accounts", expect.objectContaining({ sort: "-short" })),
    );
  });

  it("Export sends the currently active search/owner/status/sort params, not an unfiltered list", async () => {
    vi.mocked(modulesApi.exportModuleList).mockResolvedValue(new Blob(["csv"]));
    URL.createObjectURL = vi.fn(() => "blob:mock-url");
    URL.revokeObjectURL = vi.fn();
    render(
      <MemoryRouter>
        <ModuleListPage moduleKey="accounts" onRowClick={vi.fn()} />
      </MemoryRouter>,
    );
    await screen.findByText("Kaveri Steel");
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "kaveri" } });
    await waitFor(() => expect(modulesApi.getModuleList).toHaveBeenLastCalledWith("accounts", expect.objectContaining({ search: "kaveri" })));
    fireEvent.click(screen.getByRole("button", { name: /active/i }));
    await waitFor(() => expect(modulesApi.getModuleList).toHaveBeenLastCalledWith("accounts", expect.objectContaining({ status: ["Active"] })));

    fireEvent.click(screen.getByRole("button", { name: /export/i }));
    await waitFor(() =>
      expect(modulesApi.exportModuleList).toHaveBeenCalledWith(
        "accounts",
        expect.objectContaining({ search: "kaveri", status: ["Active"] }),
      ),
    );
  });

  it("requests 25 rows per page", async () => {
    render(
      <MemoryRouter>
        <ModuleListPage moduleKey="accounts" onRowClick={vi.fn()} />
      </MemoryRouter>,
    );
    await screen.findByText("Kaveri Steel");
    expect(modulesApi.getModuleList).toHaveBeenCalledWith("accounts", expect.objectContaining({ limit: 25 }));
  });

  it("shows zero counts on status tabs once facets load", async () => {
    vi.mocked(modulesApi.getModuleFacets).mockResolvedValue({ ...accountFacets, status: {} });
    render(
      <MemoryRouter>
        <ModuleListPage moduleKey="accounts" onRowClick={vi.fn()} />
      </MemoryRouter>,
    );
    await screen.findByText("Kaveri Steel");
    expect(await screen.findByRole("button", { name: /active \(0\)/i })).toBeInTheDocument();
  });

  it("offers the Board toggle for modules whose flow has at least 4 stages", async () => {
    render(
      <MemoryRouter>
        <ModuleListPage moduleKey="leads" onRowClick={vi.fn()} />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("button", { name: "Board" })).toBeInTheDocument();
  });

  it("selects rows, shows the bulk bar, and reassigns the selection", async () => {
    vi.mocked(modulesApi.updateModuleRecord).mockResolvedValue(accountRecord);
    render(
      <MemoryRouter>
        <ModuleListPage moduleKey="accounts" onRowClick={vi.fn()} />
      </MemoryRouter>,
    );
    await screen.findByText("Kaveri Steel");
    expect(screen.queryByRole("region", { name: /bulk actions/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /select kaveri steel/i }));
    const bar = await screen.findByRole("region", { name: /bulk actions/i });
    expect(within(bar).getByText("1 selected")).toBeInTheDocument();
    fireEvent.click(within(bar).getByRole("button", { name: /reassign/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Asha D" }));
    await waitFor(() => expect(modulesApi.updateModuleRecord).toHaveBeenCalledWith("accounts", "A-1021", { ownerId: "u-ad" }));
  });

  it("clears the selection from the bulk bar", async () => {
    render(
      <MemoryRouter>
        <ModuleListPage moduleKey="accounts" onRowClick={vi.fn()} />
      </MemoryRouter>,
    );
    await screen.findByText("Kaveri Steel");
    fireEvent.click(screen.getByRole("checkbox", { name: /select all/i }));
    fireEvent.click(await screen.findByRole("button", { name: /clear/i }));
    expect(screen.queryByRole("region", { name: /bulk actions/i })).not.toBeInTheDocument();
  });

  it("filters sheet: status chips toggle the status filter and the footer shows the result count", async () => {
    render(
      <MemoryRouter>
        <ModuleListPage moduleKey="accounts" onRowClick={vi.fn()} />
      </MemoryRouter>,
    );
    await screen.findByText("Kaveri Steel");
    const drawer = await openFilters();
    fireEvent.click(within(drawer).getByRole("button", { name: /^active/i }));
    await waitFor(() =>
      expect(modulesApi.getModuleList).toHaveBeenLastCalledWith("accounts", expect.objectContaining({ status: ["Active"] })),
    );
    expect(within(drawer).getByRole("button", { name: /show 1 result/i })).toBeInTheDocument();
  });

  it("filters sheet: 'My records' quick view filters to the signed-in user", async () => {
    render(
      <MemoryRouter>
        <ModuleListPage moduleKey="accounts" onRowClick={vi.fn()} />
      </MemoryRouter>,
    );
    await screen.findByText("Kaveri Steel");
    const drawer = await openFilters();
    fireEvent.click(within(drawer).getByRole("button", { name: "My records" }));
    await waitFor(() =>
      expect(modulesApi.getModuleList).toHaveBeenLastCalledWith("accounts", expect.objectContaining({ ownerId: ["u1"] })),
    );
  });

  it("embedded in another page: fixed page size and no page header of its own", async () => {
    render(
      <MemoryRouter>
        <ModuleListPage moduleKey="accounts" onRowClick={vi.fn()} embedded />
      </MemoryRouter>,
    );
    await screen.findByText("Kaveri Steel");
    expect(modulesApi.getModuleList).toHaveBeenCalledWith("accounts", expect.objectContaining({ limit: 25 }));
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /export/i })).toBeInTheDocument();
  });
});
