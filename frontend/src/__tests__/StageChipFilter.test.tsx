import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { StageChipFilter } from "../components/leads/StageChipFilter";
import { LeadStatsProvider } from "../context/LeadStatsContext";
import * as client from "../api/client";

vi.mock("../api/client");

const mockStats = [
  { stage: "NEW", _count: { stage: 14 } },
  { stage: "CONTACTED", _count: { stage: 8 } },
  { stage: "ENROLLED", _count: { stage: 5 } },
];

const renderFilter = (props: Parameters<typeof StageChipFilter>[0]) =>
  render(
    <LeadStatsProvider>
      <StageChipFilter {...props} />
    </LeadStatsProvider>,
  );

describe("StageChipFilter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the All chip immediately", () => {
    vi.mocked(client.getStageStats).mockResolvedValue([]);
    renderFilter({ activeStage: "", onChange: vi.fn() });
    expect(screen.getByText("All")).toBeInTheDocument();
  });

  it("renders stage chips after stats load", async () => {
    vi.mocked(client.getStageStats).mockResolvedValue(mockStats);
    renderFilter({ activeStage: "", onChange: vi.fn() });
    await waitFor(() => expect(screen.getByText("New")).toBeInTheDocument());
    expect(screen.getByText("Contacted")).toBeInTheDocument();
    expect(screen.getByText("Enrolled")).toBeInTheDocument();
  });

  it("shows count badges for each stage", async () => {
    vi.mocked(client.getStageStats).mockResolvedValue(mockStats);
    renderFilter({ activeStage: "", onChange: vi.fn() });
    await waitFor(() => expect(screen.getByText("14")).toBeInTheDocument());
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("shows the summed total on the All chip", async () => {
    vi.mocked(client.getStageStats).mockResolvedValue(mockStats);
    renderFilter({ activeStage: "", onChange: vi.fn() });
    await waitFor(() => expect(screen.getByText("27")).toBeInTheDocument());
  });

  it("calls onChange with empty string when All chip is clicked", async () => {
    vi.mocked(client.getStageStats).mockResolvedValue(mockStats);
    const onChange = vi.fn();
    renderFilter({ activeStage: "NEW", onChange });
    fireEvent.click(screen.getByText("All"));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("calls onChange with stage key when a stage chip is clicked", async () => {
    vi.mocked(client.getStageStats).mockResolvedValue(mockStats);
    const onChange = vi.fn();
    renderFilter({ activeStage: "", onChange });
    await waitFor(() => expect(screen.getByText("New")).toBeInTheDocument());
    fireEvent.click(screen.getByText("New"));
    expect(onChange).toHaveBeenCalledWith("NEW");
  });
});
