import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import MfgDashboardPage from "../pages/MfgDashboard";
import * as authCtx from "../context/AuthContext";
import * as mfgDashboardApi from "../api/mfgDashboard";
import * as modulesApi from "../api/modules";

vi.mock("../context/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("../api/mfgDashboard");
vi.mock("../api/modules");
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const emptyMyDay = {
  kpis: {
    dueToday: 0, overdueCount: 0, newLeadsToContact: 0, leadsPastSla: 0,
    quotesAwaitingReply: { count: 0, value: 0 }, posExpectedThisMonth: { count: 0, value: 0 },
    quarterTarget: { pct: 0, booked: 0, target: 0 },
  },
  actionQueue: [], dealsNeedingAttention: [], visitsAndTrials: [], pipelineByPhase: [],
};

const emptyTeam = {
  kpis: {
    newLeads: 0, qualifiedLeads: 0, qualificationRatePct: 0, activePipeline: 0, weightedPipeline: 0,
    quotationsIssued: { count: 0, revised: 0 }, poBooked: { count: 0, value: 0 },
    wonLost: { won: 0, lost: 0, winRatePct: 0, wonValue: 0 },
    outstanding: { amount: 0, overdueAmount: 0, overdueCount: 0 },
    targetVsAchievement: { month: { target: 100, achieved: 40, pct: 40 }, quarter: { target: 300, achieved: 40, pct: 13 } },
  },
  funnel: [], aging: [], teamPerformance: [], pendingApprovals: [], overduePayments: [],
};

function mockUser(mfgRole: string | null) {
  vi.mocked(authCtx.useAuth).mockReturnValue({
    user: { id: "u1", name: "Test", email: "t@test.com", role: "DIRECTOR", teamId: null, mfgRole },
    token: "tok", loading: false, signIn: vi.fn(), signOut: vi.fn(), updateUser: vi.fn(),
    isImpersonating: false, impersonate: vi.fn(), exitImpersonation: vi.fn(),
  } as never);
}

describe("MfgDashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mfgDashboardApi.getMfgMyDay).mockResolvedValue(emptyMyDay as never);
    vi.mocked(mfgDashboardApi.getMfgTeam).mockResolvedValue(emptyTeam as never);
  });

  it("defaults to the My day view", async () => {
    mockUser("SALES_HEAD");
    render(<MemoryRouter><MfgDashboardPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Due today")).toBeInTheDocument());
  });

  it("switches to the Team view when clicked", async () => {
    mockUser("SALES_HEAD");
    render(<MemoryRouter><MfgDashboardPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Due today")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Team"));
    await waitFor(() => expect(screen.getByText("New leads")).toBeInTheDocument());
  });

  it("links the Team KPI cards to their lists; New leads names every status so its count matches", async () => {
    mockUser("SALES_HEAD");
    render(<MemoryRouter><MfgDashboardPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Due today")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Team"));
    const newLeads = (await screen.findByText("New leads")).closest("a");
    expect(newLeads?.getAttribute("href")).toMatch(/^\/leads\?datePreset=mtd&status=New(%2C|,)Assigned.*Converted/);
    expect(screen.getByText("Quotations issued").closest("a")?.getAttribute("href")).toBe("/quotations?datePreset=mtd");
    expect(screen.getByText("Outstanding").closest("a")?.getAttribute("href")).toBe("/payments");
  });

  it("hides the Team toggle entirely for a Sales Executive", async () => {
    mockUser("SALES_EXECUTIVE");
    render(<MemoryRouter><MfgDashboardPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Due today")).toBeInTheDocument());
    expect(screen.queryByText("Team")).not.toBeInTheDocument();
  });

  it("shows the Team toggle for a caller with no mfgRole assigned yet (unrestricted fallback)", async () => {
    mockUser(null);
    render(<MemoryRouter><MfgDashboardPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Due today")).toBeInTheDocument());
    expect(screen.getByText("Team")).toBeInTheDocument();
  });

  it("completes an action-queue task with an outcome via Mark done, then reloads", async () => {
    mockUser("SALES_HEAD");
    vi.mocked(mfgDashboardApi.getMfgMyDay).mockResolvedValue({
      ...emptyMyDay,
      actionQueue: [{ id: "ACT-1", type: "Call", subject: "Call Kaveri", accountName: "Kaveri", opportunityTitle: null, dueDate: null, priority: "High", state: "today" }],
    } as never);
    vi.mocked(modulesApi.performModuleAction).mockResolvedValue({ id: "ACT-1" });
    render(<MemoryRouter><MfgDashboardPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: /mark done/i }));
    fireEvent.change(await screen.findByLabelText(/outcome/i), { target: { value: "Spoke to buyer" } });
    fireEvent.click(screen.getByRole("button", { name: /^confirm$/i }));
    await waitFor(() => expect(modulesApi.performModuleAction).toHaveBeenCalledWith("activities", "ACT-1", "Complete", { outcome: "Spoke to buyer" }));
    await waitFor(() => expect(mfgDashboardApi.getMfgMyDay).toHaveBeenCalledTimes(2));
  });

  it("pipeline-by-stage rows link to the opportunities list filtered to that stage", async () => {
    mockUser("SALES_HEAD");
    vi.mocked(mfgDashboardApi.getMfgMyDay).mockResolvedValue({
      ...emptyMyDay,
      pipelineByPhase: [{ phase: "Early", total: 100, stages: [{ stage: "Qualified", value: 100 }] }],
    } as never);
    render(<MemoryRouter><MfgDashboardPage /></MemoryRouter>);
    const row = await screen.findByRole("link", { name: /qualified/i });
    expect(row).toHaveAttribute("href", "/opportunities?status=Qualified");
  });
});
