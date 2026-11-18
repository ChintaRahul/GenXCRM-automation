import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { PipelineFunnelCard } from "../components/dashboard/PipelineFunnelCard";
import * as reportsHook from "../hooks/useReports";

vi.mock("../hooks/useReports");

const baseReturn = {
  data: null,
  loading: false,
  error: null,
  refetch: vi.fn(),
};

const mockData = [
  { stage: "NEW", _count: { stage: 612 } },
  { stage: "CONTACTED", _count: { stage: 489 } },
  { stage: "INTERESTED", _count: { stage: 327 } },
];

const STAGE_COLOR_VARS: Record<string, string> = {
  NEW: "--chart-1",
  CONTACTED: "--chart-2",
  INTERESTED: "--chart-3",
};

// Fill widths of the per-stage bars (the hero callout has no bar).
const barWidths = (container: HTMLElement): string[] =>
  [...container.querySelectorAll<HTMLElement>(".bg-muted > div")].map((el) => el.style.width);

describe("PipelineFunnelCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders skeleton while loading", () => {
    vi.mocked(reportsHook.usePipeline).mockReturnValue({
      ...baseReturn,
      loading: true,
    });
    const { container } = render(
      <PipelineFunnelCard stageColorVars={STAGE_COLOR_VARS} />,
    );
    expect(
      container.querySelectorAll('[class*="animate-pulse"]').length,
    ).toBeGreaterThan(0);
  });

  it("renders stage names and counts", () => {
    vi.mocked(reportsHook.usePipeline).mockReturnValue({
      ...baseReturn,
      data: mockData,
    });
    render(<PipelineFunnelCard stageColorVars={STAGE_COLOR_VARS} />);
    expect(screen.getByText("New")).toBeInTheDocument();
    expect(screen.getByText("612")).toBeInTheDocument();
    expect(screen.getByText("489")).toBeInTheDocument();
  });

  it("renders empty state when no rows", () => {
    vi.mocked(reportsHook.usePipeline).mockReturnValue({
      ...baseReturn,
      data: [],
    });
    render(<PipelineFunnelCard stageColorVars={STAGE_COLOR_VARS} />);
    expect(screen.getByText("No data yet")).toBeInTheDocument();
  });

  it("switching period tab re-calls usePipeline with new period", () => {
    vi.mocked(reportsHook.usePipeline).mockReturnValue({
      ...baseReturn,
      data: [],
    });
    render(<PipelineFunnelCard stageColorVars={STAGE_COLOR_VARS} />);
    fireEvent.click(screen.getByText("90d"));
    expect(reportsHook.usePipeline).toHaveBeenCalledWith("90d");
  });

  it("switching to YTD tab calls usePipeline with YTD", () => {
    vi.mocked(reportsHook.usePipeline).mockReturnValue({
      ...baseReturn,
      data: [],
    });
    render(<PipelineFunnelCard stageColorVars={STAGE_COLOR_VARS} />);
    fireEvent.click(screen.getByText("YTD"));
    expect(reportsHook.usePipeline).toHaveBeenCalledWith("YTD");
  });

  it("pulls the dominant stage out into its own hero callout", () => {
    vi.mocked(reportsHook.usePipeline).mockReturnValue({
      ...baseReturn,
      data: mockData,
    });
    render(<PipelineFunnelCard stageColorVars={STAGE_COLOR_VARS} />);

    expect(
      screen.getByText("Dominant stage, shown separately so it doesn't flatten the rest"),
    ).toBeInTheDocument();
    expect(screen.getByText(/of pipeline/)).toBeInTheDocument();
  });

  it("scales the remaining stages against their own max, not the global max", () => {
    vi.mocked(reportsHook.usePipeline).mockReturnValue({
      ...baseReturn,
      data: mockData,
    });
    const { container } = render(
      <PipelineFunnelCard stageColorVars={STAGE_COLOR_VARS} />,
    );

    // CONTACTED (489) is the max among the remaining stages -> full-width bar
    // INTERESTED: 327 / 489 -> 67% width
    expect(barWidths(container).map((w) => Math.round(parseFloat(w)))).toEqual([100, 67]);
  });

  it("shows each stage's true share of all leads in the period, not just its share of the visible max", () => {
    vi.mocked(reportsHook.usePipeline).mockReturnValue({
      ...baseReturn,
      data: mockData,
    });
    render(<PipelineFunnelCard stageColorVars={STAGE_COLOR_VARS} />);

    // total = 612 + 489 + 327 = 1428
    // hero (NEW): 612 / 1428 -> 43% of pipeline
    expect(screen.getByText("43% of pipeline")).toBeInTheDocument();
    // CONTACTED: 489 / 1428 -> 34.2%
    expect(screen.getByText(/34\.2%/)).toBeInTheDocument();
    // INTERESTED: 327 / 1428 -> 22.9%
    expect(screen.getByText(/22\.9%/)).toBeInTheDocument();
  });
});
