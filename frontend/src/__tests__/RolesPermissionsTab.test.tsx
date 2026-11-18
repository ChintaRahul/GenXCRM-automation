import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { RolesPermissionsTab } from "../components/admin/RolesPermissionsTab";
import * as modulesApi from "../api/modules";

vi.mock("../api/modules");

const rolePermissionRows = [
  { id: "rp-1", role: "SALES_EXECUTIVE", moduleKey: "opps", recordAccess: "OWN", canCreate: true, canRead: true, canUpdate: true, canDelete: false, canExport: false },
  { id: "rp-2", role: "DIRECTOR", moduleKey: "opps", recordAccess: "ALL", canCreate: true, canRead: true, canUpdate: true, canDelete: true, canExport: true },
];

const fieldPermissionRows = [
  { id: "fp-1", fieldLabel: "Standard cost", restrictedToRoles: ["SALES_EXECUTIVE"] },
  { id: "fp-2", fieldLabel: "Minimum selling price", restrictedToRoles: ["SALES_EXECUTIVE"] },
  { id: "fp-3", fieldLabel: "Costing & margin", restrictedToRoles: ["SALES_EXECUTIVE"] },
  { id: "fp-4", fieldLabel: "Approval thresholds", restrictedToRoles: [] },
  { id: "fp-5", fieldLabel: "Competitor pricing", restrictedToRoles: [] },
  { id: "fp-6", fieldLabel: "Payment receipts", restrictedToRoles: [] },
];

describe("RolesPermissionsTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(modulesApi.getModuleList).mockImplementation(async (moduleKey) => {
      if (moduleKey === "rolePermissions") return { data: rolePermissionRows, total: 2, page: 1, limit: 300, pages: 1 };
      if (moduleKey === "fieldPermissions") return { data: fieldPermissionRows, total: 6, page: 1, limit: 20, pages: 1 };
      throw new Error(`unexpected moduleKey ${moduleKey}`);
    });
    vi.mocked(modulesApi.updateModuleRecord).mockResolvedValue({ id: "rp-1" });
  });

  it("defaults to the first role and shows its CRUDE matrix for a configured module", async () => {
    render(<RolesPermissionsTab canEdit={true} />);
    await waitFor(() => expect(screen.getByText("Super Admin")).toBeInTheDocument());
    // Super Admin has no seeded row in this fixture -> "Not configured" for every module.
    expect(screen.getAllByText("Not configured").length).toBeGreaterThan(0);
  });

  it("shows the CRUDE checkboxes for a role that has a configured row", async () => {
    render(<RolesPermissionsTab canEdit={true} />);
    await waitFor(() => expect(screen.getByText("Sales Executive")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Sales Executive"));
    await waitFor(() => expect(screen.queryAllByText("Not configured").some((el) => el)).toBeDefined());
    // opps row should now render a record-access select instead of "Not configured".
    const selects = screen.getAllByRole("combobox");
    expect(selects.some((s) => (s as HTMLSelectElement).value === "OWN")).toBe(true);
  });

  it("toggles a CRUDE checkbox and saves the patch", async () => {
    render(<RolesPermissionsTab canEdit={true} />);
    await waitFor(() => expect(screen.getByText("Sales Executive")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Sales Executive"));
    await waitFor(() => expect(screen.getAllByRole("checkbox").length).toBeGreaterThan(0));
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]);
    await waitFor(() =>
      expect(modulesApi.updateModuleRecord).toHaveBeenCalledWith("rolePermissions", "rp-1", expect.objectContaining({ canCreate: false })),
    );
  });

  it("disables all controls when canEdit is false", async () => {
    render(<RolesPermissionsTab canEdit={false} />);
    await waitFor(() => expect(screen.getByText("Sales Executive")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Sales Executive"));
    await waitFor(() => expect(screen.getAllByRole("checkbox").length).toBeGreaterThan(0));
    for (const checkbox of screen.getAllByRole("checkbox")) {
      expect(checkbox).toBeDisabled();
    }
  });

  it("toggles a field-security switch and saves the updated restrictedToRoles array", async () => {
    render(<RolesPermissionsTab canEdit={true} />);
    await waitFor(() => expect(screen.getByText("Sales Executive")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Sales Executive"));
    const switchEl = await screen.findByLabelText("Restrict Approval thresholds for SALES_EXECUTIVE");
    fireEvent.click(switchEl);
    await waitFor(() =>
      expect(modulesApi.updateModuleRecord).toHaveBeenCalledWith("fieldPermissions", "fp-4", { restrictedToRoles: ["SALES_EXECUTIVE"] }),
    );
  });
});
