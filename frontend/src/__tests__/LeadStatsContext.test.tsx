import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { LeadStatsProvider, useLeadStats } from "../context/LeadStatsContext";
import * as client from "../api/client";

vi.mock("../api/client");

function Probe() {
  const { total, orgTotal, refresh } = useLeadStats();
  return (
    <div>
      <span data-testid="total">{total}</span>
      <span data-testid="org-total">{orgTotal}</span>
      <button onClick={() => void refresh({ cities: ["Bangalore"] })}>
        refresh-filtered
      </button>
    </div>
  );
}

describe("LeadStatsContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exposes total as the sum of per-stage counts", async () => {
    vi.mocked(client.getStageStats).mockResolvedValue([
      { stage: "NEW", _count: { stage: 14 } },
      { stage: "CONTACTED", _count: { stage: 8 } },
    ]);
    render(
      <LeadStatsProvider>
        <Probe />
      </LeadStatsProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("total")).toHaveTextContent("22"),
    );
  });

  it("refetches stats when refresh is called", async () => {
    // refresh() fires three requests (filtered stats + unfiltered orgTotal + MTD) per
    // call — queue three identical responses per invocation (mount, then the click).
    vi.mocked(client.getStageStats)
      .mockResolvedValueOnce([{ stage: "NEW", _count: { stage: 3 } }])
      .mockResolvedValueOnce([{ stage: "NEW", _count: { stage: 3 } }])
      .mockResolvedValueOnce([{ stage: "NEW", _count: { stage: 3 } }])
      .mockResolvedValueOnce([{ stage: "NEW", _count: { stage: 9 } }])
      .mockResolvedValueOnce([{ stage: "NEW", _count: { stage: 9 } }])
      .mockResolvedValueOnce([{ stage: "NEW", _count: { stage: 9 } }]);
    render(
      <LeadStatsProvider>
        <Probe />
      </LeadStatsProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("total")).toHaveTextContent("3"),
    );
    fireEvent.click(screen.getByText("refresh-filtered"));
    await waitFor(() =>
      expect(screen.getByTestId("total")).toHaveTextContent("9"),
    );
  });

  it("keeps orgTotal unfiltered even when refresh is called with filters", async () => {
    // Mount: unfiltered baseline is 22 leads total across two stages.
    vi.mocked(client.getStageStats).mockResolvedValueOnce([
      { stage: "NEW", _count: { stage: 14 } },
      { stage: "CONTACTED", _count: { stage: 8 } },
    ]);
    // Mount's second (unfiltered orgTotal) call — same 22.
    vi.mocked(client.getStageStats).mockResolvedValueOnce([
      { stage: "NEW", _count: { stage: 14 } },
      { stage: "CONTACTED", _count: { stage: 8 } },
    ]);
    // Mount's third (MTD) call.
    vi.mocked(client.getStageStats).mockResolvedValueOnce([
      { stage: "NEW", _count: { stage: 5 } },
    ]);
    render(
      <LeadStatsProvider>
        <Probe />
      </LeadStatsProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("org-total")).toHaveTextContent("22"),
    );

    // A filtered refresh (e.g. city=Bangalore) narrows `stats`/`total` to 2, but
    // orgTotal — driven by the always-unfiltered second call — must stay at 22.
    vi.mocked(client.getStageStats)
      .mockResolvedValueOnce([{ stage: "NEW", _count: { stage: 2 } }])
      .mockResolvedValueOnce([
        { stage: "NEW", _count: { stage: 14 } },
        { stage: "CONTACTED", _count: { stage: 8 } },
      ])
      .mockResolvedValueOnce([{ stage: "NEW", _count: { stage: 5 } }]);
    fireEvent.click(screen.getByText("refresh-filtered"));

    await waitFor(() =>
      expect(screen.getByTestId("total")).toHaveTextContent("2"),
    );
    expect(screen.getByTestId("org-total")).toHaveTextContent("22");
  });
});
