import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { RecentLeadsCard } from "../components/dashboard/RecentLeadsCard";
import { TooltipProvider } from "../components/ui/tooltip";
import * as leadsHook from "../hooks/useLeads";
import type { Lead } from "../types";

vi.mock("../hooks/useLeads");

const mockLead: Lead = {
  id: "1",
  name: "Rahul Sharma",
  phone: "+919876543210",
  source: "INSTAGRAM",
  stage: "INTERESTED",
  score: 84,
  interestedCount: 1,
  tags: [],
  createdAt: new Date(Date.now() - 2 * 60_000).toISOString(),
  updatedAt: new Date().toISOString(),
  assignedTo: { id: "u1", name: "Priya Nair" },
};

const emptyReturn = {
  leads: [],
  total: 0,
  pages: 0,
  loading: false,
  error: null,
  refetch: vi.fn(),
};

describe("RecentLeadsCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the card heading", () => {
    vi.mocked(leadsHook.useLeads).mockReturnValue(emptyReturn);
    render(
      <MemoryRouter>
        <TooltipProvider>
          <RecentLeadsCard />
        </TooltipProvider>
      </MemoryRouter>,
    );
    expect(screen.getByText("Recent leads")).toBeInTheDocument();
  });

  it("renders a lead name when data is loaded", () => {
    vi.mocked(leadsHook.useLeads).mockReturnValue({
      ...emptyReturn,
      leads: [mockLead],
      total: 1,
      pages: 1,
    });
    render(
      <MemoryRouter>
        <TooltipProvider>
          <RecentLeadsCard />
        </TooltipProvider>
      </MemoryRouter>,
    );
    expect(screen.getByText("Rahul Sharma")).toBeInTheDocument();
  });

  it("renders UNASSIGNED badge for leads with no assignedTo", () => {
    const unassigned = { ...mockLead, assignedTo: undefined };
    vi.mocked(leadsHook.useLeads).mockReturnValue({
      ...emptyReturn,
      leads: [unassigned],
      total: 1,
      pages: 1,
    });
    render(
      <MemoryRouter>
        <TooltipProvider>
          <RecentLeadsCard />
        </TooltipProvider>
      </MemoryRouter>,
    );
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
  });

  it("renders owner first name for assigned leads", () => {
    vi.mocked(leadsHook.useLeads).mockReturnValue({
      ...emptyReturn,
      leads: [mockLead],
      total: 1,
      pages: 1,
    });
    render(
      <MemoryRouter>
        <TooltipProvider>
          <RecentLeadsCard />
        </TooltipProvider>
      </MemoryRouter>,
    );
    expect(screen.getByText("Priya")).toBeInTheDocument();
  });

  it("renders skeletons while loading and hides the table", () => {
    vi.mocked(leadsHook.useLeads).mockReturnValue({
      ...emptyReturn,
      loading: true,
    });
    const { container } = render(
      <MemoryRouter>
        <TooltipProvider>
          <RecentLeadsCard />
        </TooltipProvider>
      </MemoryRouter>,
    );
    expect(container.querySelector("table")).toBeNull();
    expect(
      container.querySelectorAll('[class*="animate-pulse"]').length,
    ).toBeGreaterThan(0);
  });
});
