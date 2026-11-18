import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import LeadsPage from "../pages/Leads";
import { TooltipProvider } from "../components/ui/tooltip";
import * as client from "../api/client";
import type { User, Lead } from "../types";

vi.mock("../api/client");
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("../context/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("../context/LeadStatsContext", () => ({ useLeadStats: vi.fn() }));

import * as authCtx from "../context/AuthContext";
import * as leadStatsCtx from "../context/LeadStatsContext";

const mockUser: User = {
  id: "u1",
  name: "Alice Rep",
  email: "alice@co.com",
  role: "DIRECTOR",
  teamId: null,
};

const mockLead: Lead = {
  id: "lead-1",
  name: "Rahul Chinta",
  phone: "918793467886",
  source: "FACEBOOK",
  stage: "NEW",
  score: 10,
  interestedCount: 0,
  tags: [],
  createdAt: "2026-09-13T00:00:00.000Z",
  updatedAt: "2026-09-13T00:00:00.000Z",
  // Stored keyed by the custom field definition's stable id, per resolveOrgFields.
  customFields: { "cf-1": "50-100" },
};

describe("LeadsPage — org custom field column", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authCtx.useAuth).mockReturnValue({
      user: mockUser,
      token: "tok",
      loading: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
      updateUser: vi.fn(),
      isImpersonating: false,
      impersonate: vi.fn(),
      exitImpersonation: vi.fn(),
    });
    vi.mocked(leadStatsCtx.useLeadStats).mockReturnValue({
      stats: [],
      total: 0,
      orgTotal: 0,
      mtdTotal: 0,
      loading: false,
      refresh: vi.fn(),
    });
    vi.mocked(client.getUsers).mockResolvedValue([]);
    vi.mocked(client.getTeams).mockResolvedValue([]);
    vi.mocked(client.getImportMappings).mockResolvedValue([]);
    vi.mocked(client.getStageStats).mockResolvedValue([]);
    vi.mocked(client.getFieldMappings).mockResolvedValue({
      coreFieldAliases: {},
      customFieldDefs: [
        { id: "cf-1", name: "New Leads Per Month", aliases: "how_many_new_leads_do_you_receive_per_month?" },
      ],
      detectedFields: [],
    });
    vi.mocked(client.getLeads).mockResolvedValue({
      data: [mockLead],
      total: 1,
      page: 1,
      limit: 20,
    } as never);
  });

  it("reads a custom field's value by the definition's id, not its display name", async () => {
    render(
      <MemoryRouter>
        <TooltipProvider>
          <LeadsPage />
        </TooltipProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText("New Leads Per Month")).toBeInTheDocument());
    expect(screen.getByText("50-100")).toBeInTheDocument();
  });

  it("sorts only after a header is clicked: asc, then desc, then off", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <TooltipProvider>
          <LeadsPage />
        </TooltipProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText("New Leads Per Month")).toBeInTheDocument());
    expect(vi.mocked(client.getLeads).mock.calls.at(-1)?.[0]).not.toHaveProperty("sortBy", "score");

    await user.click(screen.getByRole("button", { name: "Score" }));
    await waitFor(() =>
      expect(vi.mocked(client.getLeads).mock.calls.at(-1)?.[0]).toMatchObject({ sortBy: "score", sortOrder: "asc" }),
    );
    await user.click(screen.getByRole("button", { name: "Score" }));
    await waitFor(() =>
      expect(vi.mocked(client.getLeads).mock.calls.at(-1)?.[0]).toMatchObject({ sortBy: "score", sortOrder: "desc" }),
    );
    await user.click(screen.getByRole("button", { name: "Score" }));
    await waitFor(() =>
      expect(vi.mocked(client.getLeads).mock.calls.at(-1)?.[0]).toMatchObject({ sortBy: undefined }),
    );
  });
});
