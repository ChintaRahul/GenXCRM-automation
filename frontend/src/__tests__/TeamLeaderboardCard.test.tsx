import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { TeamLeaderboardCard } from "../components/dashboard/TeamLeaderboardCard";
import * as reportsHook from "../hooks/useReports";

vi.mock("../hooks/useReports");

const emptyReturn = {
  data: null,
  loading: false,
  error: null,
  refetch: vi.fn(),
};

const mockEntries = [
  {
    teamId: "t1",
    teamName: "Growth Team",
    total: 30,
    enrolled: 24,
    conversionRate: 80,
    target: 30,
    revenueCollected: 340_000,
  },
  {
    teamId: "t2",
    teamName: "North Zone",
    total: 25,
    enrolled: 14,
    conversionRate: 56,
    target: 25,
    revenueCollected: 180_000,
  },
];

describe("TeamLeaderboardCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the card heading", () => {
    vi.mocked(reportsHook.useTeamLeaderboard).mockReturnValue({
      ...emptyReturn,
      data: [],
    });
    render(<TeamLeaderboardCard />);
    expect(screen.getByText("Team leaderboard")).toBeInTheDocument();
  });

  it("renders current month in the pill instead of MTD", () => {
    vi.mocked(reportsHook.useTeamLeaderboard).mockReturnValue({
      ...emptyReturn,
      data: [],
    });
    render(<TeamLeaderboardCard />);
    expect(screen.queryByText("MTD")).toBeNull();
    const monthLabel = new Date().toLocaleDateString("en-IN", {
      month: "long",
      year: "numeric",
    });
    expect(screen.getByText(monthLabel)).toBeInTheDocument();
  });

  it("renders team names and enrolled/target counts", () => {
    vi.mocked(reportsHook.useTeamLeaderboard).mockReturnValue({
      ...emptyReturn,
      data: mockEntries,
    });
    render(<TeamLeaderboardCard />);
    expect(screen.getByText("Growth Team")).toBeInTheDocument();
    expect(screen.getByText("North Zone")).toBeInTheDocument();
    expect(screen.getByText("24")).toBeInTheDocument();
  });

  it("shows enrolled/target denominator when target is present", () => {
    vi.mocked(reportsHook.useTeamLeaderboard).mockReturnValue({
      ...emptyReturn,
      data: mockEntries,
    });
    render(<TeamLeaderboardCard />);
    expect(screen.queryByText("/30", { exact: false })).toBeInTheDocument();
  });

  it("shows '% to target' sub-line when target is present", () => {
    vi.mocked(reportsHook.useTeamLeaderboard).mockReturnValue({
      ...emptyReturn,
      data: mockEntries,
    });
    render(<TeamLeaderboardCard />);
    expect(screen.getAllByText(/% to target/).length).toBeGreaterThan(0);
  });

  it("does not show 'conversion rate' text when target is present", () => {
    vi.mocked(reportsHook.useTeamLeaderboard).mockReturnValue({
      ...emptyReturn,
      data: mockEntries,
    });
    render(<TeamLeaderboardCard />);
    expect(screen.queryByText(/conversion rate/)).toBeNull();
  });

  it("shows revenue per rep using rupeeShort format", () => {
    vi.mocked(reportsHook.useTeamLeaderboard).mockReturnValue({
      ...emptyReturn,
      data: mockEntries,
    });
    render(<TeamLeaderboardCard />);
    expect(screen.getByText("₹3.4L")).toBeInTheDocument();
    expect(screen.getByText("₹1.8L")).toBeInTheDocument();
  });

  it("falls back to total denominator and shows conversion rate when target is 0 (unset)", () => {
    const noTargetEntries = mockEntries.map((e) => ({ ...e, target: 0 }));
    vi.mocked(reportsHook.useTeamLeaderboard).mockReturnValue({
      ...emptyReturn,
      data: noTargetEntries,
    });
    render(<TeamLeaderboardCard />);
    expect(screen.getAllByText(/conversion rate/).length).toBeGreaterThan(0);
  });

  it("renders skeletons while loading", () => {
    vi.mocked(reportsHook.useTeamLeaderboard).mockReturnValue({
      ...emptyReturn,
      loading: true,
    });
    const { container } = render(<TeamLeaderboardCard />);
    expect(
      container.querySelectorAll('[class*="animate-pulse"]').length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText("Growth Team")).toBeNull();
  });

  it("renders empty state when data is empty array", () => {
    vi.mocked(reportsHook.useTeamLeaderboard).mockReturnValue({
      ...emptyReturn,
      data: [],
    });
    render(<TeamLeaderboardCard />);
    expect(screen.getByText("No team data yet")).toBeInTheDocument();
  });

  it("highlights the top entry with amber rank badge", () => {
    vi.mocked(reportsHook.useTeamLeaderboard).mockReturnValue({
      ...emptyReturn,
      data: mockEntries,
    });
    const { container } = render(<TeamLeaderboardCard />);
    const rankBadges = container.querySelectorAll('[class*="bg-amber"]');
    expect(rankBadges.length).toBeGreaterThan(0);
  });
});
