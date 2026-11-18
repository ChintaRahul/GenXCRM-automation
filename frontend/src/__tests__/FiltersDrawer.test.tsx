import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { FiltersDrawer, emptyLeadFilters } from "../components/leads/FiltersDrawer";
import * as facetsHook from "../hooks/useLeadFilterFacets";
import * as assignableHook from "../hooks/useAssignableUsers";
import * as teamsHook from "../hooks/useTeams";
import * as savedViewsHook from "../hooks/useSavedViews";
import * as authCtx from "../context/AuthContext";
import type { Team } from "../types";

vi.mock("../hooks/useLeadFilterFacets");
vi.mock("../hooks/useAssignableUsers");
vi.mock("../hooks/useTeams");
vi.mock("../hooks/useSavedViews");
vi.mock("../context/AuthContext", () => ({ useAuth: vi.fn() }));

describe("FiltersDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authCtx.useAuth).mockReturnValue({
      user: { id: "u1", name: "Dir", email: "d@t.com", role: "DIRECTOR", teamId: null },
      token: "tok",
      loading: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
      updateUser: vi.fn(),
      isImpersonating: false,
      impersonate: vi.fn(),
      exitImpersonation: vi.fn(),
    });
    vi.mocked(facetsHook.useLeadFilterFacets).mockReturnValue({
      facets: {
        stages: [{ value: "NEW", count: 3 }],
        sources: [{ value: "WEBSITE", count: 2 }],
        courses: ["Digital Marketing"],
        cities: ["Pune"],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    vi.mocked(assignableHook.useAssignableUsers).mockReturnValue({
      users: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    vi.mocked(teamsHook.useTeams).mockReturnValue({
      teams: [{ id: "team-1", name: "Sales North" } as unknown as Team],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    vi.mocked(savedViewsHook.useSavedViews).mockReturnValue({
      views: [],
      saveView: vi.fn(),
      deleteView: vi.fn(),
    });
  });

  it("renders every filter section when open", () => {
    render(
      <FiltersDrawer
        open
        onOpenChange={vi.fn()}
        value={emptyLeadFilters()}
        onChange={vi.fn()}
        resultCount={42}
      />,
    );
    expect(screen.getByText("Filters")).toBeInTheDocument();
    expect(screen.getByText("Date range")).toBeInTheDocument();
    expect(screen.getByText("Saved views")).toBeInTheDocument();
    expect(screen.getByText("Stage")).toBeInTheDocument();
    expect(screen.getByText("Source")).toBeInTheDocument();
    expect(screen.getByText("Owner")).toBeInTheDocument();
    expect(screen.getByText("Course")).toBeInTheDocument();
    expect(screen.getByText("City")).toBeInTheDocument();
    expect(screen.getByText("Lead score")).toBeInTheDocument();
    expect(screen.getByText("Showing 42 leads")).toBeInTheDocument();
  });

  it("shows the Team filter for DIRECTOR and applies a selection", () => {
    const onChange = vi.fn();
    render(
      <FiltersDrawer
        open
        onOpenChange={vi.fn()}
        value={emptyLeadFilters()}
        onChange={onChange}
        resultCount={5}
      />,
    );
    expect(screen.getByText("Team")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Sales North"));
    fireEvent.click(screen.getByText("Apply"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ teamIds: ["team-1"] }),
    );
  });

  it("hides the Team filter for MANAGER (already scoped to their own team)", () => {
    vi.mocked(authCtx.useAuth).mockReturnValue({
      user: { id: "u2", name: "Mgr", email: "m@t.com", role: "MANAGER", teamId: "team-1" },
      token: "tok",
      loading: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
      updateUser: vi.fn(),
      isImpersonating: false,
      impersonate: vi.fn(),
      exitImpersonation: vi.fn(),
    });
    render(
      <FiltersDrawer
        open
        onOpenChange={vi.fn()}
        value={emptyLeadFilters()}
        onChange={vi.fn()}
        resultCount={5}
      />,
    );
    expect(screen.queryByText("Team")).not.toBeInTheDocument();
  });

  it("does not apply a selection until Apply is clicked", () => {
    const onChange = vi.fn();
    render(
      <FiltersDrawer
        open
        onOpenChange={vi.fn()}
        value={emptyLeadFilters()}
        onChange={onChange}
        resultCount={5}
      />,
    );
    fireEvent.click(screen.getByText("Hot leads only"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("Apply commits the draft to the parent and closes the sheet", () => {
    const onChange = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <FiltersDrawer
        open
        onOpenChange={onOpenChange}
        value={emptyLeadFilters()}
        onChange={onChange}
        resultCount={5}
      />,
    );
    fireEvent.click(screen.getByText("Hot leads only"));
    fireEvent.click(screen.getByText("Apply"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ hotOnly: true }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("Clear all resets the drawer's selections and applies immediately", () => {
    const onChange = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <FiltersDrawer
        open
        onOpenChange={onOpenChange}
        value={{ ...emptyLeadFilters(), hotOnly: true }}
        onChange={onChange}
        resultCount={5}
      />,
    );
    const hotToggle = screen.getByText("Hot leads only")
      .closest("label")
      ?.querySelector("input") as HTMLInputElement;
    expect(hotToggle.checked).toBe(true);
    fireEvent.click(screen.getByText("Clear all"));
    expect(hotToggle.checked).toBe(false);
    expect(onChange).toHaveBeenCalledWith(emptyLeadFilters());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("reopening the drawer discards an unapplied draft", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <FiltersDrawer
        open
        onOpenChange={vi.fn()}
        value={emptyLeadFilters()}
        onChange={onChange}
        resultCount={5}
      />,
    );
    fireEvent.click(screen.getByText("Hot leads only"));
    // Close without applying, then reopen — draft should reset to `value`.
    rerender(
      <FiltersDrawer
        open={false}
        onOpenChange={vi.fn()}
        value={emptyLeadFilters()}
        onChange={onChange}
        resultCount={5}
      />,
    );
    rerender(
      <FiltersDrawer
        open
        onOpenChange={vi.fn()}
        value={emptyLeadFilters()}
        onChange={onChange}
        resultCount={5}
      />,
    );
    const hotToggle = screen.getByText("Hot leads only")
      .closest("label")
      ?.querySelector("input") as HTMLInputElement;
    expect(hotToggle.checked).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });
});
