import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AuditTab } from "../components/module/AuditTab";
import * as modulesApi from "../api/modules";

vi.mock("../api/modules");

describe("AuditTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a row per entry with old and new values", async () => {
    vi.mocked(modulesApi.getModuleAudit).mockResolvedValue([
      { id: "a1", at: "2026-09-28", user: "Jane", field: "status", oldValue: "New", newValue: "Qualified" },
    ]);
    render(<AuditTab moduleKey="accounts" id="A-1" />);
    await waitFor(() => expect(screen.getByText("Jane")).toBeInTheDocument());
    const newElements = screen.getAllByText("New");
    expect(newElements.length).toBeGreaterThan(0);
    expect(screen.getByText("Qualified")).toBeInTheDocument();
  });

  it("shows an empty state when there are no entries", async () => {
    vi.mocked(modulesApi.getModuleAudit).mockResolvedValue([]);
    render(<AuditTab moduleKey="accounts" id="A-1" />);
    await waitFor(() => expect(screen.getByText(/no changes recorded yet/i)).toBeInTheDocument());
  });

  it("shows a loading state before the fetch resolves", () => {
    vi.mocked(modulesApi.getModuleAudit).mockReturnValue(new Promise(() => {}));
    render(<AuditTab moduleKey="accounts" id="A-1" />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });
});
