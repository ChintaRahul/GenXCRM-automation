import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { toast } from "sonner";
import { AdminModuleTab } from "../components/admin/AdminModuleTab";
import * as modulesApi from "../api/modules";
import { useModuleRights } from "../hooks/useModuleRights";

vi.mock("../api/modules");
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("../hooks/useModuleRights", () => ({ useModuleRights: vi.fn() }));
// The list and the form are covered by their own tests — stub them so this suite only exercises
// the Delete wiring AdminModuleTab adds around them.
vi.mock("../components/module/ModuleListPage", () => ({
  ModuleListPage: ({ onRowClick }: { onRowClick: (record: { id: string }) => void }) => (
    <button onClick={() => onRowClick({ id: "rule-1" })}>open rule</button>
  ),
}));
vi.mock("../components/module/ModuleFormDrawer", () => ({
  ModuleFormDrawer: ({ open, editingId, onDelete }: { open: boolean; editingId?: string; onDelete?: () => void }) =>
    open ? <div>{editingId && onDelete ? <button onClick={onDelete}>Delete</button> : <span>drawer without delete</span>}</div> : null,
}));

const rights = (del: boolean) => ({ create: true, read: true, update: true, delete: del });

describe("AdminModuleTab delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useModuleRights).mockReturnValue(rights(true));
    vi.mocked(modulesApi.archiveModuleRecord).mockResolvedValue(undefined);
  });

  it("offers Delete for a role with the Delete right and archives the record after confirming", async () => {
    render(<AdminModuleTab moduleKey="automationRules" canEdit />);
    fireEvent.click(screen.getByText("open rule"));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    expect(await screen.findByText(/Delete this/i)).toBeInTheDocument();
    expect(modulesApi.archiveModuleRecord).not.toHaveBeenCalled();
    // The dialog's confirm button is the second "Delete".
    fireEvent.click(screen.getAllByRole("button", { name: "Delete" }).at(-1) as HTMLElement);
    await waitFor(() => expect(modulesApi.archiveModuleRecord).toHaveBeenCalledWith("automationRules", "rule-1"));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it("does not offer Delete to a role without the Delete right", async () => {
    vi.mocked(useModuleRights).mockReturnValue(rights(false));
    render(<AdminModuleTab moduleKey="automationRules" canEdit />);
    fireEvent.click(screen.getByText("open rule"));
    expect(await screen.findByText("drawer without delete")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("keeps the record and shows an error when the archive fails", async () => {
    vi.mocked(modulesApi.archiveModuleRecord).mockRejectedValue(new Error("boom"));
    render(<AdminModuleTab moduleKey="automationRules" canEdit />);
    fireEvent.click(screen.getByText("open rule"));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Delete" }).at(-1) as HTMLElement);
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
  });
});
