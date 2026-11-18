import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventsTab } from "../components/module/EventsTab";
import * as modulesApi from "../api/modules";

vi.mock("../api/modules");

describe("EventsTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders each event with its label and timestamp", async () => {
    vi.mocked(modulesApi.getModuleEvents).mockResolvedValue([
      { id: "e1", at: "2026-09-28T10:00:00Z", label: "Moved to Qualified", actor: "Jane" },
    ]);
    render(<EventsTab moduleKey="opps" id="OP-1" tabKey="history" label="Stage history" />);
    await waitFor(() => expect(screen.getByText("Moved to Qualified")).toBeInTheDocument());
    expect(screen.getByText("Jane")).toBeInTheDocument();
  });

  it("shows an error message on a failed fetch", async () => {
    vi.mocked(modulesApi.getModuleEvents).mockRejectedValue(new Error("boom"));
    render(<EventsTab moduleKey="opps" id="OP-1" tabKey="history" label="Stage history" />);
    await waitFor(() => expect(screen.getByText(/couldn.t load/i)).toBeInTheDocument());
  });

  it("shows an empty state naming the tab when there are no events", async () => {
    vi.mocked(modulesApi.getModuleEvents).mockResolvedValue([]);
    render(<EventsTab moduleKey="opps" id="OP-1" tabKey="history" label="Stage history" />);
    await waitFor(() => expect(screen.getByText(/no stage history recorded yet/i)).toBeInTheDocument());
  });

  it("shows a loading state before the fetch resolves", () => {
    vi.mocked(modulesApi.getModuleEvents).mockReturnValue(new Promise(() => {}));
    render(<EventsTab moduleKey="opps" id="OP-1" tabKey="history" label="Stage history" />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });
});
