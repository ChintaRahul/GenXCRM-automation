import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AutomationRunHistory } from "../components/admin/AutomationRunHistory";
import * as modulesApi from "../api/modules";

vi.mock("../api/modules");

describe("AutomationRunHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists each run with its status and details", async () => {
    vi.mocked(modulesApi.getModuleEvents).mockResolvedValue([
      { id: "r1", at: "2026-11-05T10:00:00Z", label: "OK", description: "Notified owner" },
      { id: "r2", at: "2026-11-04T10:00:00Z", label: "Failed", description: "No owner" },
    ] as never);
    render(<AutomationRunHistory ruleId="rule-1" />);
    expect(await screen.findByText("Notified owner")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(modulesApi.getModuleEvents).toHaveBeenCalledWith("automationRules", "rule-1", "runs");
  });

  it("says so when the rule has not run", async () => {
    vi.mocked(modulesApi.getModuleEvents).mockResolvedValue([]);
    render(<AutomationRunHistory ruleId="rule-1" />);
    expect(await screen.findByText("This rule hasn't run yet.")).toBeInTheDocument();
  });

  it("shows an error when the history can't be loaded", async () => {
    vi.mocked(modulesApi.getModuleEvents).mockRejectedValue(new Error("boom"));
    render(<AutomationRunHistory ruleId="rule-1" />);
    expect(await screen.findByText("Couldn't load the run history.")).toBeInTheDocument();
  });
});
