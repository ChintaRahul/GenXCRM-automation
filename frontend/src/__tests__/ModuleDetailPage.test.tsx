import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ModuleDetailPage } from "../components/module/ModuleDetailPage";
import * as modulesApi from "../api/modules";
import * as authCtx from "../context/AuthContext";

vi.mock("../api/modules");
// Header (rendered by ModuleDetailPage) calls useAuth() with no fallback context value,
// so it throws when mounted outside an <AuthProvider> — same mocking pattern already
// used by LeadDetail.test.tsx and ModuleListPage.test.tsx in this suite.
vi.mock("../context/AuthContext", () => ({ useAuth: vi.fn() }));

const leadRecord = {
  id: "LD-5101", company: "Shivalik Paper Mills", contact: "Harish Bansal", status: "New",
  owner: "vj", source: "IndiaMART", product: "Weighbridge",
};

// The record page shows one main + one secondary action; the rest live in the "⋯" menu.
const findAction = async (name: RegExp | string) => {
  const direct = screen.queryByRole("button", { name });
  if (direct) return direct;
  fireEvent.click(await screen.findByRole("button", { name: /more actions/i }));
  return screen.findByRole("button", { name });
};

describe("ModuleDetailPage", () => {
  function setupDefaultMocks() {
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
    vi.mocked(modulesApi.getModuleRecord).mockResolvedValue(leadRecord);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
    vi.mocked(modulesApi.archiveModuleRecord).mockResolvedValue(undefined);
  });

  it("shows a friendly no-access message when the record fetch is forbidden (403)", async () => {
    vi.mocked(modulesApi.getModuleRecord).mockRejectedValue(
      Object.assign(new Error("Request failed with status code 403"), { isAxiosError: true, response: { status: 403 } }),
    );
    render(
      <MemoryRouter>
        <ModuleDetailPage moduleKey="costing" id="CS-1" onEdit={vi.fn()} />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/don.t have access to costing/i)).toBeInTheDocument();
    expect(screen.queryByText(/couldn.t load this record/i)).not.toBeInTheDocument();
  });

  it("renders the record's id/title and status pill", async () => {
    render(
      <MemoryRouter>
        <ModuleDetailPage moduleKey="leads" id="LD-5101" onEdit={vi.fn()} />
      </MemoryRouter>,
    );
    // Header's subtitle renders as "Leads / LD-5101" (one text node), so match by
    // substring rather than an exact string.
    expect(await screen.findByText(/LD-5101/)).toBeInTheDocument();
    expect(screen.getByText("Shivalik Paper Mills")).toBeInTheDocument();
    expect(screen.getByText("New")).toBeInTheDocument();
  });

  it("shows a status progress bar for a module with `flow`, using the flow order", async () => {
    render(
      <MemoryRouter>
        <ModuleDetailPage moduleKey="leads" id="LD-5101" onEdit={vi.fn()} />
      </MemoryRouter>,
    );
    await screen.findByText("Shivalik Paper Mills");
    // Leads' flow is New -> Assigned -> Contacted -> Follow-up -> Qualified; each step's
    // label should render somewhere in the progress bar region.
    expect(screen.getByTestId("status-progress-bar")).toBeInTheDocument();
    expect(within(screen.getByTestId("status-progress-bar")).getByText("Qualified")).toBeInTheDocument();
  });

  it("only shows actions valid for the record's current status (when/notWhen)", async () => {
    render(
      <MemoryRouter>
        <ModuleDetailPage moduleKey="leads" id="LD-5101" onEdit={vi.fn()} />
      </MemoryRouter>,
    );
    await screen.findByText("Shivalik Paper Mills");
    // "Mark contacted" is when:['New','Assigned'] — visible for a New lead.
    expect(screen.getByRole("button", { name: /mark contacted/i })).toBeInTheDocument();
    // "Convert to opportunity" is when:['Qualified'] — must NOT show for a New lead.
    expect(screen.queryByRole("button", { name: /convert to opportunity/i })).not.toBeInTheDocument();
  });

  it("respects notWhen-only actions (no `when` at all) — Opportunities' Advance stage", async () => {
    vi.mocked(modulesApi.getModuleRecord).mockResolvedValue({ id: "OP-1", title: "Deal", stage: "Won" });
    render(
      <MemoryRouter>
        <ModuleDetailPage moduleKey="opps" id="OP-1" onEdit={vi.fn()} />
      </MemoryRouter>,
    );
    await screen.findByText("Deal");
    // "Advance stage" is notWhen:['Won','Lost','PO received'] — must NOT show once Won.
    expect(screen.queryByRole("button", { name: /advance stage/i })).not.toBeInTheDocument();
  });

  it("clicking an action with no `ask` calls runAction directly", async () => {
    vi.mocked(modulesApi.performModuleAction).mockResolvedValue({ ...leadRecord, status: "Contacted" });
    render(
      <MemoryRouter>
        <ModuleDetailPage moduleKey="leads" id="LD-5101" onEdit={vi.fn()} />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole("button", { name: /mark contacted/i }));
    await waitFor(() =>
      expect(modulesApi.performModuleAction).toHaveBeenCalledWith("leads", "LD-5101", "Mark contacted", undefined),
    );
  });

  it("clicking an action with `ask` opens ActionDialog instead of running immediately", async () => {
    render(
      <MemoryRouter>
        <ModuleDetailPage moduleKey="leads" id="LD-5101" onEdit={vi.fn()} />
      </MemoryRouter>,
    );
    fireEvent.click(await findAction(/disqualify/i));
    expect(await screen.findByText(/disqualification reason/i)).toBeInTheDocument();
    expect(modulesApi.performModuleAction).not.toHaveBeenCalled();
  });

  it("shows an error message instead of looping on Loading… when the record fetch fails", async () => {
    vi.mocked(modulesApi.getModuleRecord).mockRejectedValue(new Error("Network error"));
    render(
      <MemoryRouter>
        <ModuleDetailPage moduleKey="leads" id="LD-5101" onEdit={vi.fn()} />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/couldn.t load this record/i)).toBeInTheDocument();
  });

  it("shows an amber restricted banner and blocks Edit for a restricted module the caller marks inaccessible", async () => {
    vi.mocked(modulesApi.getModuleRecord).mockResolvedValue({ id: "CS-1", status: "Draft" });
    render(
      <MemoryRouter>
        <ModuleDetailPage moduleKey="costing" id="CS-1" onEdit={vi.fn()} hasModuleAccess={false} />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/costing is restricted/i)).toBeInTheDocument();
  });

  it("renders the auto-added SLA tab (as a placeholder) for a module with sla-eligible content", async () => {
    render(
      <MemoryRouter>
        <ModuleDetailPage moduleKey="leads" id="LD-5101" onEdit={vi.fn()} />
      </MemoryRouter>,
    );
    await screen.findByText("Shivalik Paper Mills");
    expect(screen.getByRole("tab", { name: /sla/i })).toBeInTheDocument();
  });

  it("calls onSpecialAction (not the API) when a special action is clicked", async () => {
    const onSpecialAction = vi.fn();
    vi.mocked(modulesApi.getModuleRecord).mockResolvedValue({ id: "LD-5090", status: "Qualified" });
    render(
      <MemoryRouter>
        <ModuleDetailPage moduleKey="leads" id="LD-5090" onEdit={vi.fn()} onSpecialAction={onSpecialAction} />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole("button", { name: /convert to opportunity/i }));
    expect(onSpecialAction).toHaveBeenCalledWith("convert", expect.objectContaining({ id: "LD-5090" }), undefined);
    expect(modulesApi.performModuleAction).not.toHaveBeenCalled();
  });

  it("passes the entered value through as the third onSpecialAction argument for an action with both `special` and `ask`", async () => {
    const onSpecialAction = vi.fn();
    vi.mocked(modulesApi.getModuleRecord).mockResolvedValue({ id: "PM-1", status: "Due" });
    render(
      <MemoryRouter>
        <ModuleDetailPage moduleKey="payments" id="PM-1" onEdit={vi.fn()} onSpecialAction={onSpecialAction} />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole("button", { name: /record receipt/i }));
    const input = await screen.findByLabelText(/amount received/i);
    fireEvent.change(input, { target: { value: "50000" } });
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    await waitFor(() =>
      expect(onSpecialAction).toHaveBeenCalledWith("receipt", expect.objectContaining({ id: "PM-1" }), "50000"),
    );
    expect(modulesApi.performModuleAction).not.toHaveBeenCalled();
  });

  it("shows Acknowledge handover on a pending sales order and hides it once acknowledged", async () => {
    vi.mocked(modulesApi.getModuleRecord).mockResolvedValue({ id: "SO-1", status: "Order accepted", ackStatus: "Pending" });
    const { unmount } = render(
      <MemoryRouter>
        <ModuleDetailPage moduleKey="sorders" id="SO-1" onEdit={vi.fn()} />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("button", { name: /acknowledge handover/i })).toBeInTheDocument();
    unmount();
    vi.mocked(modulesApi.getModuleRecord).mockResolvedValue({ id: "SO-1", status: "Order accepted", ackStatus: "Acknowledged" });
    render(
      <MemoryRouter>
        <ModuleDetailPage moduleKey="sorders" id="SO-1" onEdit={vi.fn()} />
      </MemoryRouter>,
    );
    await screen.findByRole("button", { name: /edit/i });
    expect(screen.queryByRole("button", { name: /acknowledge handover/i })).not.toBeInTheDocument();
  });

  it("renders TableTab content for a table-kind tab", async () => {
    vi.mocked(modulesApi.getModuleRecord).mockImplementation(async () =>
      ({ id: "A-1021", short: "Kaveri Steel", status: "Active" })
    );
    vi.mocked(modulesApi.getModuleTable).mockImplementation(async () => ({
      columns: [{ key: "name", label: "Plant", type: "text" }],
      rows: [{ name: "Plant 1" }],
    }));
    render(
      <MemoryRouter>
        <ModuleDetailPage moduleKey="accounts" id="A-1021" onEdit={vi.fn()} />
      </MemoryRouter>,
    );
    await screen.findByText("Kaveri Steel");
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /plants/i }));
    await waitFor(() => expect(modulesApi.getModuleTable).toHaveBeenCalledWith("accounts", "A-1021", "plants"));
    expect(await screen.findByText("Plant 1")).toBeInTheDocument();
  });

  it("renders EventsTab content for an events-kind tab", async () => {
    vi.mocked(modulesApi.getModuleRecord).mockImplementation(async () =>
      ({ id: "OP-1", title: "Deal", stage: "Qualified" })
    );
    vi.mocked(modulesApi.getModuleEvents).mockImplementation(async () =>
      [{ id: "e1", at: "2026-09-28T10:00:00Z", label: "Moved to Qualified" }]
    );
    render(
      <MemoryRouter>
        <ModuleDetailPage moduleKey="opps" id="OP-1" onEdit={vi.fn()} />
      </MemoryRouter>,
    );
    await screen.findByText("Deal");
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /stage history/i }));
    await waitFor(() => expect(modulesApi.getModuleEvents).toHaveBeenCalledWith("opps", "OP-1", "history"));
    expect(await screen.findByText("Moved to Qualified")).toBeInTheDocument();
  });

  it("renders real SlaTab, DocumentsTab, and AuditTab content instead of placeholder text", async () => {
    vi.mocked(modulesApi.getModuleAudit).mockImplementation(async () => []);
    vi.mocked(modulesApi.getModuleRecord).mockResolvedValue({ ...leadRecord, sla: { l: "Due in 2h", t: "green" } });
    render(
      <MemoryRouter>
        <ModuleDetailPage moduleKey="leads" id="LD-5101" onEdit={vi.fn()} />
      </MemoryRouter>,
    );
    await screen.findByText("Shivalik Paper Mills");
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /^sla$/i }));
    expect((await screen.findAllByText("Due in 2h")).length).toBeGreaterThan(0);
    expect(screen.queryByText(/sla policies aren.t configured yet/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /audit trail/i }));
    await waitFor(() => expect(modulesApi.getModuleAudit).toHaveBeenCalledWith("leads", "LD-5101"));
    expect(screen.queryByText(/audit trail isn.t wired up yet/i)).not.toBeInTheDocument();
  });

  it("Archive opens a confirmation dialog instead of archiving immediately", async () => {
    render(
      <MemoryRouter>
        <ModuleDetailPage moduleKey="leads" id="LD-5101" onEdit={vi.fn()} />
      </MemoryRouter>,
    );
    fireEvent.click(await findAction(/^archive$/i));
    expect(await screen.findByText(/archive this lead\?/i)).toBeInTheDocument();
    expect(modulesApi.archiveModuleRecord).not.toHaveBeenCalled();
  });

  it("confirming the Archive dialog calls archiveModuleRecord and then onArchived", async () => {
    const onArchived = vi.fn();
    render(
      <MemoryRouter>
        <ModuleDetailPage moduleKey="leads" id="LD-5101" onEdit={vi.fn()} onArchived={onArchived} />
      </MemoryRouter>,
    );
    fireEvent.click(await findAction(/^archive$/i));
    await screen.findByText(/archive this lead\?/i);
    // The dialog's own confirm button and the header's trigger button share the accessible
    // name "Archive" — query within the dialog to disambiguate.
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^archive$/i }));
    await waitFor(() => expect(modulesApi.archiveModuleRecord).toHaveBeenCalledWith("leads", "LD-5101"));
    await waitFor(() => expect(onArchived).toHaveBeenCalled());
  });

  it("Cancel in the Archive dialog does not call archiveModuleRecord", async () => {
    render(
      <MemoryRouter>
        <ModuleDetailPage moduleKey="leads" id="LD-5101" onEdit={vi.fn()} />
      </MemoryRouter>,
    );
    fireEvent.click(await findAction(/^archive$/i));
    await screen.findByText(/archive this lead\?/i);
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByText(/archive this lead\?/i)).not.toBeInTheDocument());
    expect(modulesApi.archiveModuleRecord).not.toHaveBeenCalled();
  });

  it("shows the Won status badge for an opportunity outside the stage flow", async () => {
    vi.mocked(modulesApi.getModuleRecord).mockResolvedValue({ id: "OP-1", title: "Weigh scale deal", stage: "Won" });
    render(
      <MemoryRouter>
        <ModuleDetailPage moduleKey="opps" id="OP-1" onEdit={vi.fn()} />
      </MemoryRouter>,
    );
    const badge = await screen.findByTestId("status-badge");
    expect(within(badge).getByText("Won")).toBeInTheDocument();
  });

  it("shows the server's reason on screen when an action is rejected", async () => {
    vi.mocked(modulesApi.performModuleAction).mockRejectedValue({
      response: { data: { message: { message: "Capture Budget, Need on the Qualification tab before qualifying this lead." } } },
    });
    vi.mocked(modulesApi.getModuleRecord).mockResolvedValue({ ...leadRecord, status: "Contacted" });
    render(
      <MemoryRouter>
        <ModuleDetailPage moduleKey="leads" id="LD-5101" onEdit={vi.fn()} />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole("button", { name: /^qualify$/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/capture budget, need/i);
  });

  it("asks for confirmation before an action that declares one, and does nothing on Cancel", async () => {
    vi.mocked(modulesApi.getModuleRecord).mockResolvedValue({ id: "C-1", name: "Anil", status: "Active", accountId: "A-1" });
    vi.mocked(modulesApi.performModuleAction).mockResolvedValue({ id: "C-1", name: "Anil", status: "Inactive" });
    render(
      <MemoryRouter>
        <ModuleDetailPage moduleKey="contacts" id="C-1" onEdit={vi.fn()} />
      </MemoryRouter>,
    );
    fireEvent.click(await findAction(/^mark inactive$/i));
    expect(await screen.findByText(/won't be offered when picking a contact/i)).toBeInTheDocument();
    expect(modulesApi.performModuleAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(modulesApi.performModuleAction).not.toHaveBeenCalled();
    fireEvent.click(await findAction(/^mark inactive$/i));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^mark inactive$/i }));
    await waitFor(() => expect(modulesApi.performModuleAction).toHaveBeenCalledWith("contacts", "C-1", "Mark inactive", undefined));
  });

  it("shows a key-facts line and the summary rail with the next-action card", async () => {
    vi.mocked(modulesApi.getModuleRecord).mockResolvedValue({ ...leadRecord, value: 4800000, next: "Send quote", nextDate: "2020-01-01" });
    render(
      <MemoryRouter>
        <ModuleDetailPage moduleKey="leads" id="LD-5101" onEdit={vi.fn()} />
      </MemoryRouter>,
    );
    const facts = await screen.findByTestId("key-facts");
    expect(facts).toHaveTextContent("₹48.0 L");
    const rail = screen.getByTestId("summary-rail");
    expect(within(rail).getByText("Send quote")).toBeInTheDocument();
    expect(within(rail).getByText(/overdue/i)).toBeInTheDocument();
  });

  it("flags a missing next action in the rail", async () => {
    render(
      <MemoryRouter>
        <ModuleDetailPage moduleKey="leads" id="LD-5101" onEdit={vi.fn()} />
      </MemoryRouter>,
    );
    expect(await within(await screen.findByTestId("summary-rail")).findByText("No next action set")).toBeInTheDocument();
  });

  it("copy link is always in the ⋯ menu", async () => {
    render(
      <MemoryRouter>
        <ModuleDetailPage moduleKey="leads" id="LD-5101" onEdit={vi.fn()} />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole("button", { name: /more actions/i }));
    expect(await screen.findByRole("button", { name: /copy link/i })).toBeInTheDocument();
  });

  it("on phones the actions move to a fixed bottom bar", async () => {
    const prev = window.innerWidth;
    window.innerWidth = 390;
    try {
      render(
        <MemoryRouter>
          <ModuleDetailPage moduleKey="leads" id="LD-5101" onEdit={vi.fn()} />
        </MemoryRouter>,
      );
      const bar = await screen.findByTestId("mobile-action-bar");
      expect(within(bar).getByRole("button", { name: "Edit" })).toBeInTheDocument();
      expect(within(bar).getByRole("button", { name: /more actions/i })).toBeInTheDocument();
    } finally {
      window.innerWidth = prev;
    }
  });

  it("hides Edit and Archive when the role may not update or delete here", async () => {
    render(
      <MemoryRouter>
        <ModuleDetailPage moduleKey="leads" id="LD-5101" onEdit={vi.fn()} canEdit={false} canArchive={false} />
      </MemoryRouter>,
    );
    await screen.findByRole("button", { name: /more actions/i });
    expect(screen.queryByRole("button", { name: /^edit$/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /more actions/i }));
    expect(await screen.findByRole("button", { name: /copy link/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^archive$/i })).not.toBeInTheDocument();
  });
});
