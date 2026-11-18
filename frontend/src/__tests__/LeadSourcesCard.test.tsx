import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { LeadSourcesCard } from "../components/dashboard/LeadSourcesCard";
import * as reportsHook from "../hooks/useReports";

vi.mock("../hooks/useReports");

const baseReturn = {
  data: null,
  loading: false,
  error: null,
  refetch: vi.fn(),
};

const mockSources = [
  { source: "FACEBOOK", _count: { source: 38 } },
  { source: "GOOGLE_ADS", _count: { source: 62 } },
];

describe("LeadSourcesCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the card heading", () => {
    vi.mocked(reportsHook.useSourceStats).mockReturnValue({
      ...baseReturn,
      data: [],
    });
    render(<LeadSourcesCard />);
    expect(screen.getByText("Lead sources")).toBeInTheDocument();
  });

  it("renders skeleton while loading", () => {
    vi.mocked(reportsHook.useSourceStats).mockReturnValue({
      ...baseReturn,
      loading: true,
    });
    const { container } = render(<LeadSourcesCard />);
    expect(
      container.querySelectorAll('[class*="animate-pulse"]').length,
    ).toBeGreaterThan(0);
  });

  it("renders source names in legend", () => {
    vi.mocked(reportsHook.useSourceStats).mockReturnValue({
      ...baseReturn,
      data: mockSources,
    });
    render(<LeadSourcesCard />);
    expect(screen.getByText("Facebook")).toBeInTheDocument();
    expect(screen.getByText("Google Ads")).toBeInTheDocument();
  });

  it("shows correct rounded percentages in legend (38% and 62%)", () => {
    vi.mocked(reportsHook.useSourceStats).mockReturnValue({
      ...baseReturn,
      data: mockSources,
    });
    render(<LeadSourcesCard />);
    expect(screen.getByText("38%")).toBeInTheDocument();
    expect(screen.getByText("62%")).toBeInTheDocument();
  });

  it("shows total count in donut center", () => {
    vi.mocked(reportsHook.useSourceStats).mockReturnValue({
      ...baseReturn,
      data: mockSources,
    });
    render(<LeadSourcesCard />);
    expect(screen.getByText("100")).toBeInTheDocument();
  });

  it("renders empty state when no sources", () => {
    vi.mocked(reportsHook.useSourceStats).mockReturnValue({
      ...baseReturn,
      data: [],
    });
    render(<LeadSourcesCard />);
    expect(screen.getByText("No data yet")).toBeInTheDocument();
  });

  it("does not render sparkline section when dailyInflow is empty", () => {
    vi.mocked(reportsHook.useSourceStats).mockReturnValue({
      ...baseReturn,
      data: mockSources,
    });
    render(<LeadSourcesCard dailyInflow={[]} />);
    expect(screen.queryByText("Daily inflow")).toBeNull();
  });

  it("renders sparkline section when dailyInflow is provided", () => {
    vi.mocked(reportsHook.useSourceStats).mockReturnValue({
      ...baseReturn,
      data: mockSources,
    });
    const inflow = Array.from({ length: 30 }, (_, i) => 10 + i);
    render(<LeadSourcesCard dailyInflow={inflow} />);
    expect(screen.getByText("Daily inflow")).toBeInTheDocument();
  });
});
