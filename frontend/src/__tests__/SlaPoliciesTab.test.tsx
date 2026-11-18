import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SlaPoliciesTab } from "../components/admin/SlaPoliciesTab";
import * as modulesApi from "../api/modules";

vi.mock("../api/modules");

const policies = [
  {
    id: "sla-1", moduleKey: "leads", name: "Lead first response", startEvent: "Lead created",
    stopEvent: "First call / message logged", calendarType: "Business hours",
    targets: [{ cond: "All leads", val: 2, unit: "hours" }],
    escalationLevels: [{ at: 100, who: "Owner", channels: ["Email"] }],
    pauseStatuses: [], isActive: true,
  },
  {
    id: "sla-2", moduleKey: "opps", name: "Stage stagnation", startEvent: "Stage entered",
    stopEvent: "Stage changed", calendarType: "Calendar days",
    targets: [{ cond: "Stage = Qualified", val: 7, unit: "days" }],
    escalationLevels: [{ at: 100, who: "Owner", channels: ["In-app"] }],
    pauseStatuses: ["Waiting on customer"], isActive: false,
  },
];

describe("SlaPoliciesTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(modulesApi.getModuleList).mockResolvedValue({ data: policies, total: 2, page: 1, limit: 100, pages: 1 });
    vi.mocked(modulesApi.performModuleAction).mockResolvedValue({ id: "sla-1" });
  });

  it("groups policies by moduleKey and shows the active count", async () => {
    render(<SlaPoliciesTab canEdit={true} />);
    await waitFor(() => expect(screen.getByText("Lead first response")).toBeInTheDocument());
    expect(screen.getByText("Leads")).toBeInTheDocument();
    expect(screen.getByText("Opportunities")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument(); // active count
  });

  it("expands a policy row to show its targets and escalation levels", async () => {
    render(<SlaPoliciesTab canEdit={true} />);
    await waitFor(() => expect(screen.getByText("Lead first response")).toBeInTheDocument());
    fireEvent.click(screen.getAllByLabelText("Expand")[0]);
    expect(await screen.findByLabelText("All leads target value")).toHaveValue(2);
    expect(screen.getByLabelText("All leads target unit")).toHaveValue("hours");
    expect(screen.getByText("At 100% → Owner (Email)")).toBeInTheDocument();
  });

  it("saves an edited target as minutes so a short test target can be set", async () => {
    vi.mocked(modulesApi.updateModuleRecord).mockResolvedValue({ id: "sla-1" });
    render(<SlaPoliciesTab canEdit={true} />);
    await waitFor(() => expect(screen.getByText("Lead first response")).toBeInTheDocument());
    fireEvent.click(screen.getAllByLabelText("Expand")[0]);
    fireEvent.change(await screen.findByLabelText("All leads target value"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("All leads target unit"), { target: { value: "minutes" } });
    fireEvent.click(screen.getByRole("button", { name: "Save targets" }));
    await waitFor(() =>
      expect(modulesApi.updateModuleRecord).toHaveBeenCalledWith("slaPolicies", "sla-1", { targets: [{ cond: "All leads", val: 2, unit: "minutes" }] }),
    );
  });

  it("shows the pause-statuses note only when the policy has one", async () => {
    render(<SlaPoliciesTab canEdit={true} />);
    await waitFor(() => expect(screen.getByText("Stage stagnation")).toBeInTheDocument());
    const expandButtons = screen.getAllByLabelText("Expand");
    fireEvent.click(expandButtons[1]);
    expect(await screen.findByText("Pauses while: Waiting on customer")).toBeInTheDocument();
  });

  it("toggling the switch calls Deactivate for an active policy and Activate for an inactive one", async () => {
    render(<SlaPoliciesTab canEdit={true} />);
    await waitFor(() => expect(screen.getByText("Lead first response")).toBeInTheDocument());
    const switches = screen.getAllByRole("switch");
    fireEvent.click(switches[0]); // active -> Deactivate
    await waitFor(() => expect(modulesApi.performModuleAction).toHaveBeenCalledWith("slaPolicies", "sla-1", "Deactivate"));
    fireEvent.click(switches[1]); // inactive -> Activate
    await waitFor(() => expect(modulesApi.performModuleAction).toHaveBeenCalledWith("slaPolicies", "sla-2", "Activate"));
  });

  it("disables the switches when canEdit is false", async () => {
    render(<SlaPoliciesTab canEdit={false} />);
    await waitFor(() => expect(screen.getByText("Lead first response")).toBeInTheDocument());
    for (const s of screen.getAllByRole("switch")) {
      expect(s).toBeDisabled();
    }
  });
});
