import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ErpSyncPanel } from "../components/admin/ErpSyncPanel";
import * as modulesApi from "../api/modules";

vi.mock("../api/modules");
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe("ErpSyncPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the sync log of the connection", async () => {
    vi.mocked(modulesApi.getModuleEvents).mockResolvedValue([
      { id: "e1", at: "2026-11-05T10:00:00Z", label: "customers: Sent (3)" },
    ] as never);
    render(<ErpSyncPanel connectionId="erp-1" />);
    expect(await screen.findByText("customers: Sent (3)")).toBeInTheDocument();
    expect(modulesApi.getModuleEvents).toHaveBeenCalledWith("erp", "erp-1", "log");
  });

  it("runs the sync and reloads the log", async () => {
    vi.mocked(modulesApi.getModuleEvents).mockResolvedValue([]);
    vi.mocked(modulesApi.performModuleAction).mockResolvedValue({} as never);
    render(<ErpSyncPanel connectionId="erp-1" />);
    await userEvent.click(await screen.findByRole("button", { name: "Sync now" }));
    await waitFor(() => expect(modulesApi.performModuleAction).toHaveBeenCalledWith("erp", "erp-1", "Sync now"));
    await waitFor(() => expect(modulesApi.getModuleEvents).toHaveBeenCalledTimes(2));
  });

  it("says so when nothing has been sent", async () => {
    vi.mocked(modulesApi.getModuleEvents).mockResolvedValue([]);
    render(<ErpSyncPanel connectionId="erp-1" />);
    expect(await screen.findByText("Nothing has been sent yet.")).toBeInTheDocument();
  });
});
