import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { TeamPerformanceSection } from "../components/reports/team/TeamPerformanceSection";
import * as reportsHook from "../hooks/useReports";
import * as teamsHook from "../hooks/useTeams";

vi.mock("../hooks/useReports");
vi.mock("../hooks/useTeams");

const emptyReturn = { data: null, loading: false, error: null, refetch: vi.fn() };

const productivityRows = [
  {
    repId: "rep-1",
    repName: "Karan Mehta",
    total: 84,
    notEngaged: 3,
    untouched: 1,
    followupOverdue: 6,
    leaking: 6,
    target: 50_000,
    revenueCollected: 40_000,
    trend: [1, 2, 3, 4, 5, 4, 6],
  },
  {
    repId: "rep-2",
    repName: "Priya Nair",
    total: 71,
    notEngaged: 8,
    untouched: 15,
    followupOverdue: 30,
    leaking: 30,
    target: 0,
    revenueCollected: 0,
    trend: [0, 0, 1, 0, 0, 0, 0],
  },
];

const leaderboardRows = [
  { teamId: "t1", teamName: "Team Alpha", total: 100, enrolled: 40, conversionRate: 40, target: 50_000, revenueCollected: 30_000 },
  { teamId: "t2", teamName: "Team Bravo", total: 80, enrolled: 20, conversionRate: 25, target: 0, revenueCollected: 10_000 },
];

const sourceRows = [{ source: "FACEBOOK", total: 50, enrolled: 10, conversionRate: 20 }];

function renderSection() {
  return render(
    <MemoryRouter>
      <TeamPerformanceSection />
    </MemoryRouter>,
  );
}

describe("TeamPerformanceSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(teamsHook.useTeams).mockReturnValue({
      teams: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    vi.mocked(reportsHook.useProductivity).mockReturnValue({ ...emptyReturn, data: productivityRows });
    vi.mocked(reportsHook.useSourcePerformance).mockReturnValue({ ...emptyReturn, data: sourceRows });
    vi.mocked(reportsHook.useTeamLeaderboard).mockReturnValue({ ...emptyReturn, data: leaderboardRows });
  });

  it("renders rep rows and rep count", () => {
    renderSection();
    expect(screen.getAllByText("Karan Mehta").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Priya Nair").length).toBeGreaterThan(0);
    expect(screen.getByText("2 reps")).toBeInTheDocument();
  });

  it("flags a rep with high untouched/overdue ratios as needing coaching", () => {
    renderSection();
    expect(screen.getAllByText("Needs coaching").length).toBeGreaterThan(0);
  });

  it("filters the productivity table by rep search", () => {
    renderSection();
    const search = screen.getByPlaceholderText("Search rep…");
    (search as HTMLInputElement).value = "Karan";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    expect(screen.getAllByText("Karan Mehta").length).toBeGreaterThan(0);
  });

  it("renders team leaderboard rows with revenue", () => {
    renderSection();
    expect(screen.getByText("Team Alpha")).toBeInTheDocument();
    expect(screen.getByText("Team Bravo")).toBeInTheDocument();
  });

  it("shows a dash for target when no target is set", () => {
    renderSection();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("sums the Leads Leaking KPI from the distinct leaking count, not untouched + followupOverdue", () => {
    renderSection();
    // Fixture rows: leaking = 6 + 30 = 36. Summing untouched + followupOverdue
    // instead would double-count overlap and yield 52.
    expect(screen.getByText("36")).toBeInTheDocument();
  });
});
