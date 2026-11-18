import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { toast } from "sonner";
import { ModuleDetailRoute } from "../components/module/ModuleDetailRoute";
import * as modulesApi from "../api/modules";
import * as authCtx from "../context/AuthContext";

vi.mock("../api/modules");
// The shared test setup gives owner/reference pickers no options; this suite picks a new owner ("u2").
vi.mock("../lib/lookupNames", () => ({
  LookupName: ({ id }: { id: unknown }) => (typeof id === "string" && id ? id : "—"),
  useLookupName: (_source: string | undefined, id: unknown) => (typeof id === "string" && id ? id : "—"),
  useLookupOptions: () => ({ options: [{ id: "u2", label: "User Two" }], loading: false }),
  resetLookupNames: () => {},
  invalidateLookup: () => {},
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock("../context/AuthContext", () => ({ useAuth: vi.fn() }));

const leadRecord = {
  id: "LD-5101", company: "Shivalik Paper Mills", contact: "Harish Bansal", status: "New",
  owner: "vj", source: "IndiaMART", product: "Weighbridge",
};

describe("ModuleDetailRoute", () => {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom doesn't implement these — stub them so downloadBlob() doesn't throw.
    URL.createObjectURL = vi.fn(() => "blob:mock-url");
    URL.revokeObjectURL = vi.fn();
    vi.mocked(authCtx.useAuth).mockReturnValue({
      user: { id: "u1", name: "Test User", email: "test@example.com", role: "SALES_REP", teamId: null },
      token: "tok", loading: false, signIn: vi.fn(), signOut: vi.fn(), updateUser: vi.fn(),
      isImpersonating: false, impersonate: vi.fn(), exitImpersonation: vi.fn(),
    } as never);
    vi.mocked(modulesApi.getModuleRecord).mockResolvedValue(leadRecord);
  });

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  it("opens the edit drawer, pre-filled from the current record, when Edit is clicked", async () => {
    render(
      <MemoryRouter initialEntries={["/leads/LD-5101"]}>
        <Routes>
          <Route path="/leads/:id" element={<ModuleDetailRoute moduleKey="leads" />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    expect(await screen.findByRole("heading", { name: /Edit Lead/i })).toBeInTheDocument();
    const companyInput = screen.getByDisplayValue("Shivalik Paper Mills") as HTMLInputElement;
    expect(companyInput).toBeInTheDocument();
  });

  it('"Convert to opportunity" (leads) opens a dialog and submits a new-account payload', async () => {
    vi.mocked(modulesApi.getModuleRecord).mockResolvedValue({ ...leadRecord, status: "Qualified" });
    vi.mocked(modulesApi.performModuleAction).mockResolvedValue({ id: "OP-9", opportunityId: "OP-9" });
    render(
      <MemoryRouter initialEntries={["/leads/LD-5101"]}>
        <Routes>
          <Route path="/leads/:id" element={<ModuleDetailRoute moduleKey="leads" />} />
          <Route path="/opportunities/:id" element={<div data-testid="opp-detail">Opp detail</div>} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Convert to opportunity" }));
    expect(await screen.findByRole("heading", { name: "Convert to opportunity" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Contact's buying role/i), { target: { value: "Decision Maker" } });
    fireEvent.change(screen.getByLabelText(/Customer type/i), { target: { value: "Customer" } });
    fireEvent.change(screen.getByLabelText(/^Industry/i), { target: { value: "Steel & metals" } });
    fireEvent.change(screen.getByLabelText(/Territory/i), { target: { value: "North" } });
    fireEvent.click(screen.getByRole("button", { name: "Convert" }));
    await waitFor(() =>
      expect(modulesApi.performModuleAction).toHaveBeenCalledWith("leads", "LD-5101", "Convert to opportunity", {
        contactRole: "Decision Maker",
        account: { type: "Customer", industry: "Steel & metals", territory: "North", gstin: undefined },
      }),
    );
    await waitFor(() => expect(screen.getByTestId("opp-detail")).toBeInTheDocument());
  });

  it('"Convert to opportunity" (leads) auto-retries once when the backend reports a duplicate account', async () => {
    vi.mocked(modulesApi.getModuleRecord).mockResolvedValue({ ...leadRecord, status: "Qualified" });
    vi.mocked(modulesApi.performModuleAction)
      .mockResolvedValueOnce({ id: "LD-5101", duplicate: true, existingAccountId: "A-77" })
      .mockResolvedValueOnce({ id: "OP-9", opportunityId: "OP-9" });
    render(
      <MemoryRouter initialEntries={["/leads/LD-5101"]}>
        <Routes>
          <Route path="/leads/:id" element={<ModuleDetailRoute moduleKey="leads" />} />
          <Route path="/opportunities/:id" element={<div data-testid="opp-detail">Opp detail</div>} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Convert to opportunity" }));
    fireEvent.change(await screen.findByLabelText(/Contact's buying role/i), { target: { value: "Decision Maker" } });
    fireEvent.change(screen.getByLabelText(/Customer type/i), { target: { value: "Customer" } });
    fireEvent.change(screen.getByLabelText(/^Industry/i), { target: { value: "Steel & metals" } });
    fireEvent.change(screen.getByLabelText(/Territory/i), { target: { value: "North" } });
    fireEvent.click(screen.getByRole("button", { name: "Convert" }));
    await waitFor(() => expect(modulesApi.performModuleAction).toHaveBeenCalledTimes(2));
    expect(modulesApi.performModuleAction).toHaveBeenLastCalledWith(
      "leads", "LD-5101", "Convert to opportunity",
      expect.objectContaining({ accountId: "A-77" }),
    );
    await waitFor(() => expect(screen.getByTestId("opp-detail")).toBeInTheDocument());
  });

  it('"Convert to opportunity" (leads) supports picking an existing account via search', async () => {
    vi.mocked(modulesApi.getModuleRecord).mockResolvedValue({ ...leadRecord, status: "Qualified" });
    vi.mocked(modulesApi.getModuleList).mockResolvedValue({
      data: [{ id: "A-1", short: "Kaveri Steel" }], total: 1, page: 1, limit: 10, pages: 1,
    });
    vi.mocked(modulesApi.performModuleAction).mockResolvedValue({ id: "OP-9", opportunityId: "OP-9" });
    render(
      <MemoryRouter initialEntries={["/leads/LD-5101"]}>
        <Routes>
          <Route path="/leads/:id" element={<ModuleDetailRoute moduleKey="leads" />} />
          <Route path="/opportunities/:id" element={<div data-testid="opp-detail">Opp detail</div>} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Convert to opportunity" }));
    fireEvent.change(await screen.findByLabelText(/Contact's buying role/i), { target: { value: "Decision Maker" } });
    fireEvent.click(screen.getByRole("button", { name: "Existing account" }));
    fireEvent.change(screen.getByLabelText(/Search accounts/i), { target: { value: "Kaveri" } });
    fireEvent.click(await screen.findByRole("button", { name: "Kaveri Steel" }));
    fireEvent.click(screen.getByRole("button", { name: "Convert" }));
    await waitFor(() =>
      expect(modulesApi.performModuleAction).toHaveBeenCalledWith("leads", "LD-5101", "Convert to opportunity", {
        contactRole: "Decision Maker", accountId: "A-1",
      }),
    );
    await waitFor(() => expect(screen.getByTestId("opp-detail")).toBeInTheDocument());
  });

  it("navigates to the related module's mapped path when a related-tab row is clicked", async () => {
    vi.mocked(modulesApi.getModuleRelated).mockResolvedValue({
      data: [{ id: "ACT-1", subject: "Follow-up call" }], total: 1, page: 1, limit: 20, pages: 1,
    });
    render(
      <MemoryRouter initialEntries={["/leads/LD-5101"]}>
        <Routes>
          <Route path="/leads/:id" element={<ModuleDetailRoute moduleKey="leads" />} />
          <Route path="/activities/:id" element={<div data-testid="activity-detail">Activity detail</div>} />
        </Routes>
      </MemoryRouter>,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole("tab", { name: /Activities/i }));
    fireEvent.click((await screen.findAllByText("Follow-up call")).at(-1)!);
    await waitFor(() => expect(screen.getByTestId("activity-detail")).toBeInTheDocument());
  });

  it('"Reassign owner" (accounts) asks for a new owner then updates ownerId directly', async () => {
    vi.mocked(modulesApi.getModuleRecord).mockResolvedValue({ id: "A-1", short: "Kaveri Steel", status: "Active" });
    vi.mocked(modulesApi.updateModuleRecord).mockResolvedValue({ id: "A-1", ownerId: "u2" });
    render(
      <MemoryRouter initialEntries={["/x/A-1"]}>
        <Routes>
          <Route path="/x/:id" element={<ModuleDetailRoute moduleKey="accounts" />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Reassign owner" }));
    const input = await screen.findByLabelText(/New owner/i);
    fireEvent.change(input, { target: { value: "u2" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(modulesApi.updateModuleRecord).toHaveBeenCalledWith("accounts", "A-1", { ownerId: "u2" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it('"Record receipt" (payments) asks for an amount then calls performModuleAction with amt', async () => {
    vi.mocked(modulesApi.getModuleRecord).mockResolvedValue({ id: "PM-1", status: "Due", amount: 1000 });
    vi.mocked(modulesApi.performModuleAction).mockResolvedValue({ id: "PM-1", status: "Partially received" });
    render(
      <MemoryRouter initialEntries={["/x/PM-1"]}>
        <Routes>
          <Route path="/x/:id" element={<ModuleDetailRoute moduleKey="payments" />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Record receipt" }));
    const input = await screen.findByLabelText(/Amount received/i);
    fireEvent.change(input, { target: { value: "400" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(modulesApi.performModuleAction).toHaveBeenCalledWith("payments", "PM-1", "Record receipt", { amt: 400 }));
  });

  it('"Submit" (costing) calls performModuleAction directly, no dialog', async () => {
    vi.mocked(modulesApi.getModuleRecord).mockResolvedValue({ id: "CS-1", status: "Draft" });
    vi.mocked(modulesApi.performModuleAction).mockResolvedValue({ id: "CS-1", status: "Approved" });
    render(
      <MemoryRouter initialEntries={["/x/CS-1"]}>
        <Routes>
          <Route path="/x/:id" element={<ModuleDetailRoute moduleKey="costing" />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Submit" }));
    await waitFor(() => expect(modulesApi.performModuleAction).toHaveBeenCalledWith("costing", "CS-1", "Submit"));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it('"Create renewal opportunity" (amc) navigates to the newly created opportunity', async () => {
    vi.mocked(modulesApi.getModuleRecord).mockResolvedValue({ id: "CV-1", status: "Due soon" });
    vi.mocked(modulesApi.performModuleAction).mockResolvedValue({ id: "OP-9" });
    render(
      <MemoryRouter initialEntries={["/x/CV-1"]}>
        <Routes>
          <Route path="/x/:id" element={<ModuleDetailRoute moduleKey="amc" />} />
          <Route path="/opportunities/:id" element={<div data-testid="opp-detail">Opp detail</div>} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Create renewal opportunity" }));
    await waitFor(() => expect(screen.getByTestId("opp-detail")).toBeInTheDocument());
  });

  it('"Create renewal opportunity" stays on the coverage when the role cannot open Opportunities', async () => {
    vi.mocked(authCtx.useAuth).mockReturnValue({
      user: { id: "u1", name: "Service Manager", email: "sm@example.com", role: "SALES_REP", mfgRole: "Service Manager", teamId: null, org: { workspaceType: "MANUFACTURING" } },
      token: "tok", loading: false, signIn: vi.fn(), signOut: vi.fn(), updateUser: vi.fn(),
      isImpersonating: false, impersonate: vi.fn(), exitImpersonation: vi.fn(),
    } as never);
    vi.mocked(modulesApi.getReadableModules).mockResolvedValue(["amc", "service", "assets"]);
    vi.mocked(modulesApi.getModuleRecord).mockResolvedValue({ id: "CV-1", status: "Due soon" });
    vi.mocked(modulesApi.performModuleAction).mockResolvedValue({ id: "OP-9" });
    render(
      <MemoryRouter initialEntries={["/x/CV-1"]}>
        <Routes>
          <Route path="/x/:id" element={<ModuleDetailRoute moduleKey="amc" />} />
          <Route path="/opportunities/:id" element={<div data-testid="opp-detail">Opp detail</div>} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(modulesApi.getReadableModules).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole("button", { name: "Create renewal opportunity" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Renewal opportunity created."));
    expect(screen.queryByTestId("opp-detail")).not.toBeInTheDocument();
  });

  it('"Revise → new version" (quotes) navigates to the newly created version', async () => {
    vi.mocked(modulesApi.getModuleRecord).mockResolvedValue({ id: "QT-1", status: "Sent" });
    vi.mocked(modulesApi.performModuleAction).mockResolvedValue({ id: "QT-2" });
    render(
      <MemoryRouter initialEntries={["/x/QT-1"]}>
        <Routes>
          <Route path="/x/:id" element={<ModuleDetailRoute moduleKey="quotes" />} />
          <Route path="/quotations/:id" element={<div data-testid="quote-detail">Quote detail</div>} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Revise → new version" }));
    await waitFor(() => expect(screen.getByTestId("quote-detail")).toBeInTheDocument());
  });

  it('"Raise service ticket" (assets) opens a create drawer for the service module, prefilled from this asset', async () => {
    vi.mocked(modulesApi.getModuleRecord).mockResolvedValue({ id: "AS-1", serial: "SN-1", status: "Under warranty", accountId: "A-1" });
    render(
      <MemoryRouter initialEntries={["/x/AS-1"]}>
        <Routes>
          <Route path="/x/:id" element={<ModuleDetailRoute moduleKey="assets" />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Raise service ticket" }));
    expect(await screen.findByRole("heading", { name: /New Service ticket/i })).toBeInTheDocument();
    expect(screen.getByDisplayValue("AS-1")).toBeInTheDocument();
    expect(screen.getByDisplayValue("A-1")).toBeInTheDocument();
  });

  it('"Log activity" (opps) creates the activity and navigates to it on save', async () => {
    vi.mocked(modulesApi.getModuleRecord).mockResolvedValue({ id: "OP-1", title: "Weighbridge deal", stage: "Qualified", accountId: "A-1" });
    vi.mocked(modulesApi.createModuleRecord).mockResolvedValue({ id: "T-1" });
    render(
      <MemoryRouter initialEntries={["/x/OP-1"]}>
        <Routes>
          <Route path="/x/:id" element={<ModuleDetailRoute moduleKey="opps" />} />
          <Route path="/activities/:id" element={<div data-testid="activity-detail">Activity detail</div>} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Log activity" }));
    expect(await screen.findByRole("heading", { name: /New Activity/i })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Type/i), { target: { value: "Call" } });
    fireEvent.change(screen.getByLabelText(/^Subject/i), { target: { value: "Follow-up call" } });
    fireEvent.change(screen.getByLabelText(/^Scheduled for/i), { target: { value: "2099-01-01" } });
    fireEvent.change(screen.getByLabelText(/^Priority/i), { target: { value: "Medium" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(modulesApi.createModuleRecord).toHaveBeenCalledWith(
      "activities",
      expect.objectContaining({ opportunityId: "OP-1", accountId: "A-1" }),
    ));
    await waitFor(() => expect(screen.getByTestId("activity-detail")).toBeInTheDocument());
  });

  it('"New Quotation" on the opportunity Quotations tab opens the quotation form already pointing at this opportunity and account', async () => {
    vi.mocked(modulesApi.getModuleRecord).mockResolvedValue({ id: "OP-1", title: "Weighbridge deal", stage: "Qualified", accountId: "A-1" });
    render(
      <MemoryRouter initialEntries={["/x/OP-1"]}>
        <Routes>
          <Route path="/x/:id" element={<ModuleDetailRoute moduleKey="opps" />} />
        </Routes>
      </MemoryRouter>,
    );
    await userEvent.setup().click(await screen.findByRole("tab", { name: "Quotations" }));
    fireEvent.click(await screen.findByRole("button", { name: /New Quotation/i }));
    expect(await screen.findByRole("heading", { name: /New Quotation/i })).toBeInTheDocument();
    expect(screen.getByDisplayValue("OP-1")).toBeInTheDocument();
    expect(screen.getByDisplayValue("A-1")).toBeInTheDocument();
  });

  it('"Advance stage" (opps) opens a dialog asking for the next action and date, then updates the stage', async () => {
    vi.mocked(modulesApi.getModuleRecord).mockResolvedValue({ id: "OP-1", stage: "Qualified" });
    vi.mocked(modulesApi.updateModuleRecord).mockResolvedValue({ id: "OP-1", stage: "Requirement collected" });
    render(
      <MemoryRouter initialEntries={["/x/OP-1"]}>
        <Routes>
          <Route path="/x/:id" element={<ModuleDetailRoute moduleKey="opps" />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Advance stage" }));
    expect(await screen.findByRole("heading", { name: "Advance stage" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Next action \*/i), { target: { value: "Follow up" } });
    fireEvent.change(screen.getByLabelText(/Next action date/i), { target: { value: "2099-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Advance" }));
    await waitFor(() =>
      expect(modulesApi.updateModuleRecord).toHaveBeenCalledWith("opps", "OP-1", {
        stage: "Requirement collected", nextAction: "Follow up", nextActionDate: "2099-01-01",
      }),
    );
  });

  it('"Advance status" (sorders) calls performModuleAction directly when no serial is required', async () => {
    vi.mocked(modulesApi.getModuleRecord).mockResolvedValue({ id: "SO-1", status: "Order accepted" });
    vi.mocked(modulesApi.performModuleAction).mockResolvedValue({ id: "SO-1", status: "Design" });
    render(
      <MemoryRouter initialEntries={["/x/SO-1"]}>
        <Routes>
          <Route path="/x/:id" element={<ModuleDetailRoute moduleKey="sorders" />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Advance status" }));
    await waitFor(() => expect(modulesApi.performModuleAction).toHaveBeenCalledWith("sorders", "SO-1", "Advance status"));
  });

  it('"Advance status" (sorders) prompts for a serial and retries when the backend rejects for a missing one', async () => {
    vi.mocked(modulesApi.getModuleRecord).mockResolvedValue({ id: "SO-1", status: "Ready for dispatch" });
    vi.mocked(modulesApi.performModuleAction)
      .mockRejectedValueOnce(Object.assign(new Error("Request failed with status code 400"), { response: { data: { message: "'serial' is required to advance a sales order to Commissioned." } } }))
      .mockResolvedValueOnce({ id: "SO-1", status: "Commissioned" });
    render(
      <MemoryRouter initialEntries={["/x/SO-1"]}>
        <Routes>
          <Route path="/x/:id" element={<ModuleDetailRoute moduleKey="sorders" />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Advance status" }));
    expect(await screen.findByRole("heading", { name: "Serial number required" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Serial no\./i), { target: { value: "SN-42" } });
    fireEvent.click(screen.getByRole("button", { name: "Advance" }));
    await waitFor(() =>
      expect(modulesApi.performModuleAction).toHaveBeenLastCalledWith("sorders", "SO-1", "Advance status", { serial: "SN-42" }),
    );
  });

  it('"Export Excel" (reports) downloads the real generated CSV', async () => {
    vi.mocked(modulesApi.getModuleRecord).mockResolvedValue({ id: "R-1", name: "Pipeline report" });
    const csvBlob = new Blob(["a,b"], { type: "text/csv" });
    vi.mocked(modulesApi.getModuleCsv).mockResolvedValue({ blob: csvBlob, filename: "Pipeline-report.csv" });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    render(
      <MemoryRouter initialEntries={["/x/R-1"]}>
        <Routes>
          <Route path="/x/:id" element={<ModuleDetailRoute moduleKey="reports" />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Export Excel" }));
    await waitFor(() => expect(modulesApi.getModuleCsv).toHaveBeenCalledWith("reports", "R-1"));
    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
  });

  it('"Download PDF" (quotes) downloads the real generated PDF', async () => {
    vi.mocked(modulesApi.getModuleRecord).mockResolvedValue({ id: "QT-1", status: "Sent" });
    const pdfBlob = new Blob(["pdf"], { type: "application/pdf" });
    vi.mocked(modulesApi.getModulePdf).mockResolvedValue({ blob: pdfBlob, filename: "Quotation-QT-1.pdf" });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    render(
      <MemoryRouter initialEntries={["/x/QT-1"]}>
        <Routes>
          <Route path="/x/:id" element={<ModuleDetailRoute moduleKey="quotes" />} />
        </Routes>
      </MemoryRouter>,
    );
    if (!screen.queryByRole("button", { name: "Download PDF" })) {
      fireEvent.click(await screen.findByRole("button", { name: /more actions/i }));
    }
    fireEvent.click(await screen.findByRole("button", { name: "Download PDF" }));
    await waitFor(() => expect(modulesApi.getModulePdf).toHaveBeenCalledWith("quotes", "QT-1"));
    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
  });

  it('a module with no real PDF generator still falls back to printing the page', async () => {
    vi.mocked(modulesApi.getModuleRecord).mockResolvedValue({ id: "INV-1", period: "Oct 2026" });
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => undefined);
    render(
      <MemoryRouter initialEntries={["/x/INV-1"]}>
        <Routes>
          <Route path="/x/:id" element={<ModuleDetailRoute moduleKey="billing" />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Download invoice" }));
    await waitFor(() => expect(printSpy).toHaveBeenCalled());
    printSpy.mockRestore();
  });
});
