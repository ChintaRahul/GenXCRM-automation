import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DailyReportSection } from "../components/reports/DailyReportSection";
import * as client from "../api/client";
import * as authCtx from "../context/AuthContext";
import type { User } from "../types";

vi.mock("../api/client");
vi.mock("../context/AuthContext", () => ({ useAuth: vi.fn() }));

const repUser: User = { id: "rep-1", name: "Rep One", email: "rep@t.com", role: "SALES_REP", teamId: null };

const emptyDashboard: client.DailyDashboard = {
  totalLeads: 0,
  totalCalls: 0,
  interestedLeads: 0,
  followUpLeads: 0,
  demoScheduled: 0,
  enrollments: 0,
  revenue: 0,
  avgTicketSize: 0,
  totalLeadsDelta: null,
  totalCallsDelta: null,
  interestedLeadsDelta: null,
  followUpLeadsDelta: null,
  demoScheduledDelta: null,
  enrollmentsDelta: null,
  revenueDelta: null,
  campaignPerformance: [],
  salesPersonPerformance: [],
};

function mockAllEndpoints() {
  vi.mocked(client.getUsers).mockResolvedValue([repUser]);
  vi.mocked(client.getCampaignOptions).mockResolvedValue([{ id: "camp-1", name: "Campaign One" }]);
  vi.mocked(client.getDailyDashboard).mockResolvedValue(emptyDashboard);
  vi.mocked(client.getDailySummary).mockResolvedValue({ generated: 0, newLeads: 0, contacted: 0, pending: 0 });
  vi.mocked(client.getStatusReport).mockResolvedValue([]);
  vi.mocked(client.getEnrollmentReport).mockResolvedValue({
    totalEnrollments: 0,
    revenue: 0,
    conversionRate: 0,
    perRep: [],
  });
  vi.mocked(client.getCampaignPerformance).mockResolvedValue([]);
  vi.mocked(client.getAdSetPerformance).mockResolvedValue([]);
  vi.mocked(client.getAdPerformance).mockResolvedValue([]);
  vi.mocked(client.getLeadSourceTracking).mockResolvedValue({ data: [], total: 0, page: 1, limit: 10, pages: 1 });
}

function renderSection() {
  return render(
    <MemoryRouter>
      <DailyReportSection />
    </MemoryRouter>,
  );
}

describe("DailyReportSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockAllEndpoints();
    vi.mocked(authCtx.useAuth).mockReturnValue({
      user: { ...repUser, org: { id: "org-1", name: "Acme Academy", slug: "acme", industry: "EDTECH", size: "SMALL", country: "India", timezone: "Asia/Kolkata" } },
      token: "tok",
      loading: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
      updateUser: vi.fn(),
      isImpersonating: false,
      impersonate: vi.fn(),
      exitImpersonation: vi.fn(),
    } as unknown as ReturnType<typeof authCtx.useAuth>);
  });

  it("renders the header, filter bar, and every section in order once data loads", async () => {
    renderSection();

    expect(screen.getByText("Daily Sales & Lead Management Report")).toBeInTheDocument();
    expect(screen.getByText("Live")).toBeInTheDocument();

    await waitFor(() => expect(client.getCampaignOptions).toHaveBeenCalled());
    await screen.findByText("All campaigns");

    expect(screen.getByText(/Daily dashboard/)).toBeInTheDocument();
    expect(screen.getByText(/Lead summary/)).toBeInTheDocument();
    expect(screen.getByText(/Lead status report/)).toBeInTheDocument();
    expect(screen.getByText(/Enrollment report/)).toBeInTheDocument();
    expect(screen.getByText(/Campaign performance/)).toBeInTheDocument();
    expect(screen.getByText(/Ad set performance/)).toBeInTheDocument();
    expect(screen.getByText(/Ad performance/)).toBeInTheDocument();
    expect(screen.getByText(/Lead source tracking/)).toBeInTheDocument();
    expect(screen.getByText(/Export this report/)).toBeInTheDocument();
    expect(screen.queryByText(/Communication analytics/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Calling report/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Print layout/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Comfortable/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Compact/i })).not.toBeInTheDocument();
  });

  it("shows each table's empty-state copy when a section has no data", async () => {
    renderSection();
    expect(await screen.findByText("No campaign data for this range.")).toBeInTheDocument();
    expect(screen.getByText("No ad set data for this range.")).toBeInTheDocument();
    expect(screen.getByText("No ad data for this range.")).toBeInTheDocument();
    expect(screen.getByText("No leads in this range")).toBeInTheDocument();
  });

  it("refetches scoped reports when the From date filter changes", async () => {
    const { container } = renderSection();
    await waitFor(() => expect(client.getDailySummary).toHaveBeenCalled());

    const fromInput = container.querySelector('input[type="date"]') as HTMLInputElement;
    expect(fromInput).toBeTruthy();
    fireEvent.change(fromInput, { target: { value: "2026-08-01" } });

    await waitFor(() =>
      expect(client.getDailySummary).toHaveBeenCalledWith(expect.objectContaining({ from: "2026-08-01" })),
    );
  });

  it("updates both From and To when switching between quick date ranges", async () => {
    const { container } = renderSection();
    await waitFor(() => expect(client.getDailySummary).toHaveBeenCalled());

    const [fromInput, toInput] = Array.from(container.querySelectorAll('input[type="date"]')) as HTMLInputElement[];

    fireEvent.click(screen.getByRole("button", { name: "Yesterday" }));
    await waitFor(() => expect(fromInput.value).toBe(toInput.value));

    fireEvent.click(screen.getByRole("button", { name: "Last 7 days" }));
    await waitFor(() => {
      const today = new Date();
      const from = new Date(today);
      from.setDate(from.getDate() - 6);
      expect(toInput.value).toBe(today.toISOString().slice(0, 10));
      expect(fromInput.value).toBe(from.toISOString().slice(0, 10));
    });
  });

  it("highlights the active quick date-range button and clears the others", async () => {
    renderSection();
    await waitFor(() => expect(client.getDailySummary).toHaveBeenCalled());

    const todayButton = screen.getByRole("button", { name: "Today" });
    const yesterdayButton = screen.getByRole("button", { name: "Yesterday" });
    // The filter bar defaults to month-to-date, so "This month" starts out highlighted.
    const monthButton = screen.getByRole("button", { name: "This month" });
    expect(monthButton).toHaveAttribute("aria-pressed", "true");
    expect(todayButton).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(todayButton);
    await waitFor(() => expect(todayButton).toHaveAttribute("aria-pressed", "true"));
    expect(yesterdayButton).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(yesterdayButton);

    await waitFor(() => expect(yesterdayButton).toHaveAttribute("aria-pressed", "true"));
    expect(todayButton).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(todayButton);

    await waitFor(() => expect(todayButton).toHaveAttribute("aria-pressed", "true"));
    expect(yesterdayButton).toHaveAttribute("aria-pressed", "false");
  });
});
