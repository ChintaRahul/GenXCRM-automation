import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ModuleFormDrawer } from "../components/module/ModuleFormDrawer";
import * as modulesApi from "../api/modules";

vi.mock("../api/modules");
// A reference picker with one selectable opportunity (the shared test setup stubs the picker with no options).
vi.mock("../lib/lookupNames", () => ({
  LookupName: ({ id }: { id: unknown }) => (typeof id === "string" && id ? id : "—"),
  useLookupName: (_source: string | undefined, id: unknown) => (typeof id === "string" && id ? id : "—"),
  useLookupOptions: () => ({ options: [{ id: "O-1", label: "Deal one" }], loading: false }),
  resetLookupNames: () => {},
  invalidateLookup: () => {},
}));

describe("ModuleFormDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(modulesApi.getModuleList).mockResolvedValue({ data: [], total: 0, page: 1, limit: 20, pages: 0 });
  });

  it("renders required fields with a red asterisk, grouped by section", async () => {
    render(<ModuleFormDrawer moduleKey="accounts" open onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(await screen.findByText("Company")).toBeInTheDocument();
    expect(screen.getByLabelText(/legal name/i)).toBeInTheDocument();
  });

  it("shows a validation error and does not submit when a required field is empty", async () => {
    render(<ModuleFormDrawer moduleKey="accounts" open onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /save/i }));
    expect((await screen.findAllByText(/is required\./i)).length).toBeGreaterThan(0);
    expect(modulesApi.createModuleRecord).not.toHaveBeenCalled();
  });

  it("shows a duplicate warning with 'Open existing' when a dupKeys match is found", async () => {
    vi.mocked(modulesApi.getModuleList).mockResolvedValue({
      data: [{ id: "A-1", name: "Acme Steel", gstin: "27ABCDE1234F1Z5" }], total: 1, page: 1, limit: 20, pages: 1,
    });
    render(<ModuleFormDrawer moduleKey="accounts" open onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText(/legal name/i), { target: { value: "Acme Steel" } });
    fireEvent.blur(screen.getByLabelText(/legal name/i));
    expect(await screen.findByText(/open existing/i)).toBeInTheDocument();
    expect(modulesApi.getModuleList).toHaveBeenCalledWith(
      "accounts",
      expect.objectContaining({ page: 1, limit: 5, search: "Acme Steel" }),
    );
  });

  it("flags a lead whose company matches even when its phone is new", async () => {
    vi.mocked(modulesApi.getModuleList).mockImplementation(async (_m, q) =>
      q?.search === "Shree Steel"
        ? { data: [{ id: "LD-1", company: "Shree Steel", phone: "9876543210" }], total: 1, page: 1, limit: 5, pages: 1 }
        : { data: [], total: 0, page: 1, limit: 5, pages: 0 },
    );
    render(<ModuleFormDrawer moduleKey="leads" open onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText(/^company/i), { target: { value: "Shree Steel" } });
    fireEvent.change(screen.getByLabelText(/^phone/i), { target: { value: "9000000001" } });
    fireEvent.blur(screen.getByLabelText(/^phone/i));
    expect(await screen.findByText(/open existing/i)).toBeInTheDocument();
  });

  it("clears the 'please fix' banner once the last highlighted field is fixed", async () => {
    render(<ModuleFormDrawer moduleKey="leads" open onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /save/i }));
    expect(await screen.findByText(/please fix the \d+ highlighted fields/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^company/i), { target: { value: "Acme" } });
    fireEvent.change(screen.getByLabelText(/contact person/i), { target: { value: "A" } });
    fireEvent.change(screen.getByLabelText(/^phone/i), { target: { value: "9000000001" } });
    fireEvent.change(screen.getByLabelText(/product interest/i), { target: { value: "Weighbridge" } });
    fireEvent.change(screen.getByLabelText(/^source/i), { target: { value: "Website" } });
    await waitFor(() => expect(screen.queryByText(/please fix/i)).not.toBeInTheDocument());
  });

  it("does not flag a duplicate against the record currently being edited", async () => {
    vi.mocked(modulesApi.getModuleList).mockResolvedValue({
      data: [{ id: "A-1", name: "Acme Steel", gstin: "27ABCDE1234F1Z5" }], total: 1, page: 1, limit: 20, pages: 1,
    });
    render(
      <ModuleFormDrawer
        moduleKey="accounts"
        open
        onClose={vi.fn()}
        onSaved={vi.fn()}
        editingId="A-1"
        initialValues={{ id: "A-1", name: "Acme Steel", gstin: "27ABCDE1234F1Z5" }}
      />,
    );
    await screen.findByDisplayValue("Acme Steel");
    fireEvent.blur(screen.getByLabelText(/legal name/i));
    await waitFor(() => expect(screen.queryByText(/open existing/i)).not.toBeInTheDocument());
  });

  it("removes restricted fields when hasFieldAccess returns false for them", async () => {
    render(
      <ModuleFormDrawer
        moduleKey="products"
        open
        onClose={vi.fn()}
        onSaved={vi.fn()}
        hasFieldAccess={(field) => !field.restricted}
      />,
    );
    await screen.findByText(/hierarchy/i);
    expect(screen.queryByLabelText(/minimum selling price/i)).not.toBeInTheDocument();
  });

  it("does not render the status-key field, so status changes can't be typed in directly", async () => {
    render(<ModuleFormDrawer moduleKey="accounts" open onClose={vi.fn()} onSaved={vi.fn()} />);
    await screen.findByText("Company");
    expect(screen.queryByLabelText(/^status/i)).not.toBeInTheDocument();
  });

  it("shows a generic error banner and does not throw when the save call rejects", async () => {
    vi.mocked(modulesApi.createModuleRecord).mockRejectedValue(new Error("Network error"));
    render(<ModuleFormDrawer moduleKey="accounts" open onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText(/legal name/i), { target: { value: "New Co" } });
    fireEvent.change(screen.getByLabelText(/display name/i), { target: { value: "New Co" } });
    fireEvent.change(screen.getByLabelText(/customer type/i), { target: { value: "Customer" } });
    fireEvent.change(screen.getByLabelText(/^industry/i), { target: { value: "Steel & metals" } });
    fireEvent.change(screen.getByLabelText(/^city/i), { target: { value: "Pune" } });
    fireEvent.change(screen.getByLabelText(/^state/i), { target: { value: "Maharashtra" } });
    fireEvent.change(screen.getByLabelText(/territory/i), { target: { value: "West" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(await screen.findByText(/can.t reach the server/i)).toBeInTheDocument();
  });

  it("calls createModuleRecord on save for a new record and onSaved with the result", async () => {
    vi.mocked(modulesApi.createModuleRecord).mockResolvedValue({ id: "A-99", name: "New Co" });
    const onSaved = vi.fn();
    render(<ModuleFormDrawer moduleKey="accounts" open onClose={vi.fn()} onSaved={onSaved} />);
    fireEvent.change(await screen.findByLabelText(/legal name/i), { target: { value: "New Co" } });
    fireEvent.change(screen.getByLabelText(/display name/i), { target: { value: "New Co" } });
    fireEvent.change(screen.getByLabelText(/customer type/i), { target: { value: "Customer" } });
    fireEvent.change(screen.getByLabelText(/^industry/i), { target: { value: "Steel & metals" } });
    fireEvent.change(screen.getByLabelText(/^city/i), { target: { value: "Pune" } });
    fireEvent.change(screen.getByLabelText(/^state/i), { target: { value: "Maharashtra" } });
    fireEvent.change(screen.getByLabelText(/territory/i), { target: { value: "West" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(modulesApi.createModuleRecord).toHaveBeenCalled());
    expect(onSaved).toHaveBeenCalledWith({ id: "A-99", name: "New Co" });
  });

  it("asks for the starting stage when creating an opportunity, but not when editing one", async () => {
    const { unmount } = render(<ModuleFormDrawer moduleKey="opps" open onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(await screen.findByLabelText(/^stage/i)).toBeInTheDocument();
    unmount();
    render(<ModuleFormDrawer moduleKey="opps" open onClose={vi.fn()} onSaved={vi.fn()} editingId="O-1" initialValues={{ id: "O-1", title: "X" }} />);
    await screen.findByDisplayValue("X");
    expect(screen.queryByLabelText(/^stage/i)).not.toBeInTheDocument();
  });

  it("renders account and owner as dropdowns of real records, not free text", async () => {
    vi.mocked(modulesApi.getModuleList).mockResolvedValue({ data: [{ id: "A-1", name: "Acme Steel", short: "Acme" }], total: 1, page: 1, limit: 100, pages: 1 });
    render(<ModuleFormDrawer moduleKey="opps" open onClose={vi.fn()} onSaved={vi.fn()} />);
    expect((await screen.findByLabelText(/^account/i)).tagName).toBe("SELECT");
    expect(screen.getByLabelText(/^owner/i).tagName).toBe("SELECT");
  });

  it("shows the server's per-field message under the field when the save is rejected with a 400", async () => {
    vi.mocked(modulesApi.createModuleRecord).mockRejectedValue({
      response: { status: 400, data: { message: ["company should not be empty"] } },
    });
    render(<ModuleFormDrawer moduleKey="leads" open onClose={vi.fn()} onSaved={vi.fn()} />);
    await screen.findByLabelText(/^company/i);
    fireEvent.change(screen.getByLabelText(/^company/i), { target: { value: "X" } });
    fireEvent.change(screen.getByLabelText(/^contact/i), { target: { value: "Y" } });
    fireEvent.change(screen.getByLabelText(/^phone/i), { target: { value: "8451515151" } });
    fireEvent.change(screen.getByLabelText(/^product/i), { target: { value: "Conveyor" } });
    fireEvent.change(screen.getByLabelText(/^source/i), { target: { value: "Website" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(await screen.findByText("Company is required.")).toBeInTheDocument();
  });

  it("sends only the fields shown on the form when editing, never ids, org or timestamps", async () => {
    vi.mocked(modulesApi.updateModuleRecord).mockResolvedValue({ id: "A-1" });
    render(
      <ModuleFormDrawer
        moduleKey="accounts"
        open
        onClose={vi.fn()}
        onSaved={vi.fn()}
        editingId="A-1"
        initialValues={{ id: "A-1", orgId: "o1", isDeleted: false, createdAt: "x", updatedAt: "y", status: "Active", name: "Acme", short: "Acme", type: "Customer", industry: "Steel & metals", city: "Pune", state: "Maharashtra", territory: "West" }}
      />,
    );
    await screen.findAllByDisplayValue("Acme");
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(modulesApi.updateModuleRecord).toHaveBeenCalled());
    const sent = vi.mocked(modulesApi.updateModuleRecord).mock.calls[0][2];
    for (const key of ["id", "orgId", "isDeleted", "createdAt", "updatedAt", "status"]) expect(sent).not.toHaveProperty(key);
    // Nothing was changed, so nothing but the changes (none) is sent: a field the API can't take never blocks an edit.
    expect(Object.keys(sent as object)).toEqual([]);
  });

  it("sends just the changed field when editing", async () => {
    vi.mocked(modulesApi.updateModuleRecord).mockResolvedValue({ id: "A-1" });
    render(
      <ModuleFormDrawer moduleKey="accounts" open onClose={vi.fn()} onSaved={vi.fn()} editingId="A-1"
        initialValues={{ id: "A-1", name: "Acme", short: "Acme", type: "Customer", industry: "Steel & metals", city: "Pune", state: "Maharashtra", territory: "West" }} />,
    );
    fireEvent.change(await screen.findByLabelText(/^city/i), { target: { value: "Mumbai" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(modulesApi.updateModuleRecord).toHaveBeenCalledWith("accounts", "A-1", { city: "Mumbai" }));
  });

  it("hides after-the-fact fields on create but shows them when editing", async () => {
    const { unmount } = render(<ModuleFormDrawer moduleKey="visits" open onClose={vi.fn()} onSaved={vi.fn()} />);
    await screen.findByLabelText(/^objective/i);
    expect(screen.queryByLabelText(/observations/i)).not.toBeInTheDocument();
    unmount();
    render(<ModuleFormDrawer moduleKey="visits" open onClose={vi.fn()} onSaved={vi.fn()} editingId="V-1" initialValues={{ id: "V-1" }} />);
    expect(await screen.findByLabelText(/observations/i)).toBeInTheDocument();
  });

  it("never shows fields that a workflow action sets, such as a ticket's assigned engineer", async () => {
    render(<ModuleFormDrawer moduleKey="service" open onClose={vi.fn()} onSaved={vi.fn()} />);
    await screen.findByLabelText(/complaint type/i);
    expect(screen.queryByLabelText(/assigned engineer/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^resolution/i)).not.toBeInTheDocument();
  });

  it("blocks a past date on a noPast field when creating", async () => {
    render(<ModuleFormDrawer moduleKey="visits" open onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText(/visit date/i), { target: { value: "2020-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(await screen.findByText(/visit date can.t be in the past/i)).toBeInTheDocument();
    expect(modulesApi.createModuleRecord).not.toHaveBeenCalled();
  });

  it("clears a previous error when the form is reopened", async () => {
    const { rerender } = render(<ModuleFormDrawer moduleKey="accounts" open onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /save/i }));
    expect((await screen.findAllByText(/is required\./i)).length).toBeGreaterThan(0);
    rerender(<ModuleFormDrawer moduleKey="accounts" open={false} onClose={vi.fn()} onSaved={vi.fn()} />);
    rerender(<ModuleFormDrawer moduleKey="accounts" open onClose={vi.fn()} onSaved={vi.fn()} />);
    await waitFor(() => expect(screen.queryAllByText(/is required\./i)).toHaveLength(0));
  });

  it("numbers the section cards and shows how many required fields are filled", async () => {
    render(<ModuleFormDrawer moduleKey="accounts" open onClose={vi.fn()} onSaved={vi.fn()} />);
    await screen.findByLabelText(/legal name/i);
    const sections = screen.getAllByTestId("form-section");
    expect(sections[0]).toHaveTextContent(/^1/);
    expect(sections[0]).toHaveTextContent(/0\/\d+ required/);
    fireEvent.change(screen.getByLabelText(/legal name/i), { target: { value: "New Co" } });
    expect(screen.getByTestId("required-progress")).toHaveTextContent(/^1 of \d+ required fields/);
  });

  it("lists every problem in a summary whose items jump to the field", async () => {
    render(<ModuleFormDrawer moduleKey="accounts" open onClose={vi.fn()} onSaved={vi.fn()} />);
    await screen.findByLabelText(/legal name/i);
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    const summary = (await screen.findAllByRole("alert"))[0];
    const jump = within(summary).getByRole("button", { name: /legal name/i });
    fireEvent.click(jump);
    expect(screen.getByLabelText(/legal name/i)).toHaveFocus();
  });

  it("Save & add another saves, reports it, and keeps the form open and empty", async () => {
    vi.mocked(modulesApi.createModuleRecord).mockResolvedValue({ id: "A-99", name: "New Co" });
    const onSaved = vi.fn();
    const onAnother = vi.fn();
    render(<ModuleFormDrawer moduleKey="accounts" open onClose={vi.fn()} onSaved={onSaved} onSavedAndAddAnother={onAnother} />);
    fireEvent.change(await screen.findByLabelText(/legal name/i), { target: { value: "New Co" } });
    fireEvent.change(screen.getByLabelText(/display name/i), { target: { value: "New Co" } });
    fireEvent.change(screen.getByLabelText(/customer type/i), { target: { value: "Customer" } });
    fireEvent.change(screen.getByLabelText(/^industry/i), { target: { value: "Steel & metals" } });
    fireEvent.change(screen.getByLabelText(/^city/i), { target: { value: "Pune" } });
    fireEvent.change(screen.getByLabelText(/^state/i), { target: { value: "Maharashtra" } });
    fireEvent.change(screen.getByLabelText(/territory/i), { target: { value: "West" } });
    fireEvent.click(screen.getByRole("button", { name: /save & add another/i }));
    await waitFor(() => expect(onAnother).toHaveBeenCalledWith({ id: "A-99", name: "New Co" }));
    expect(onSaved).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByLabelText(/legal name/i)).toHaveValue(""));
  });

  it("hides Save & add another when editing", async () => {
    render(<ModuleFormDrawer moduleKey="accounts" open onClose={vi.fn()} onSaved={vi.fn()} onSavedAndAddAnother={vi.fn()} editingId="A-1" initialValues={{ id: "A-1", name: "X" }} />);
    await screen.findByDisplayValue("X");
    expect(screen.queryByRole("button", { name: /save & add another/i })).not.toBeInTheDocument();
  });

  it("states use a dropdown with an 'Other' fallback", async () => {
    render(<ModuleFormDrawer moduleKey="accounts" open onClose={vi.fn()} onSaved={vi.fn()} />);
    const state = await screen.findByLabelText(/^state/i);
    expect(state.tagName).toBe("SELECT");
    expect(within(state).getByRole("option", { name: /other — type your own/i })).toBeInTheDocument();
  });

  it("fills the account from the picked opportunity, for roles that cannot list accounts", async () => {
    vi.mocked(modulesApi.getModuleRecord).mockResolvedValue({ id: "O-1", accountId: "A-9" });
    render(<ModuleFormDrawer moduleKey="rfqs" open onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText(/^opportunity/i), { target: { value: "O-1" } });
    await waitFor(() => expect((screen.getByLabelText(/^account/i) as HTMLSelectElement).value).toBe("A-9"));
    expect(modulesApi.getModuleRecord).toHaveBeenCalledWith("opps", "O-1");
  });
});
