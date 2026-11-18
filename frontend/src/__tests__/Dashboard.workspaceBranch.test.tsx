import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import DashboardPage from "../pages/Dashboard";
import * as authCtx from "../context/AuthContext";
import * as reportsHooks from "../hooks/useReports";
import * as client from "../api/client";

vi.mock("../context/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("../hooks/useReports");
vi.mock("../api/client");
vi.mock("../pages/MfgDashboard", () => ({ default: () => <div data-testid="mfg-dashboard" /> }));
vi.mock("../components/dashboard/RecentLeadsCard", () => ({ RecentLeadsCard: () => <div /> }));
vi.mock("../components/dashboard/TeamLeaderboardCard", () => ({ TeamLeaderboardCard: () => <div /> }));
vi.mock("../components/dashboard/PipelineFunnelCard", () => ({ PipelineFunnelCard: () => <div /> }));
vi.mock("../components/dashboard/LeadSourcesCard", () => ({ LeadSourcesCard: () => <div /> }));

function mockAuth(workspaceType: "EDTECH" | "MANUFACTURING") {
  vi.mocked(authCtx.useAuth).mockReturnValue({
    user: { id: "u1", name: "Test User", email: "test@example.com", role: "DIRECTOR", teamId: null, org: { workspaceType } },
    token: "tok", loading: false, signIn: vi.fn(), signOut: vi.fn(), updateUser: vi.fn(),
    isImpersonating: false, impersonate: vi.fn(), exitImpersonation: vi.fn(),
  } as never);
}

describe("DashboardPage workspace branching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(reportsHooks.useOverview).mockReturnValue({ data: null, loading: false, error: null, refetch: vi.fn() });
    vi.mocked(client.getLeads).mockResolvedValue({ data: [], total: 0, page: 1, limit: 20, pages: 0 } as never);
  });

  it("renders the Manufacturing dashboard for a MANUFACTURING workspace", () => {
    mockAuth("MANUFACTURING");
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("mfg-dashboard")).toBeInTheDocument();
  });

  it("renders the EdTech dashboard content for an EDTECH workspace", () => {
    mockAuth("EDTECH");
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId("mfg-dashboard")).not.toBeInTheDocument();
  });
});
