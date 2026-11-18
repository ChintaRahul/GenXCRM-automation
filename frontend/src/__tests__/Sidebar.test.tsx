import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { Sidebar } from "../components/layout/Sidebar";
import type { Role, User, WorkspaceType } from "../types";

// Follows this codebase's established mocking idiom (see AccountDialog.test.tsx):
// the factory returns a bare vi.fn(), never a closed-over outer const — vi.mock
// factories are hoisted above the file's own top-level declarations, so a
// factory that reads an outer `const mockUser` at call time is a real hazard.
// Each test sets its own return value via vi.mocked(...).mockReturnValue(...).
vi.mock("../context/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("../context/LeadStatsContext", () => ({ useLeadStats: vi.fn() }));
vi.mock("../lib/theme", () => ({ useTheme: vi.fn() }));

import * as authCtx from "../context/AuthContext";
import * as leadStatsCtx from "../context/LeadStatsContext";
import * as themeCtx from "../lib/theme";

function makeUser(role: Role, workspaceType: WorkspaceType): User {
  return {
    id: "u1",
    name: "Priya Menon",
    email: "priya@acme.com",
    role,
    teamId: null,
    org: {
      id: "org-1",
      name: "Acme",
      slug: "acme",
      industry: "EDTECH",
      workspaceType,
      size: "SMALL",
      country: "India",
      timezone: "Asia/Kolkata",
      planStatus: "ACTIVE",
      trialEndsAt: "2026-12-31T00:00:00.000Z",
    },
  };
}

function mockAs(role: Role, workspaceType: WorkspaceType) {
  vi.mocked(authCtx.useAuth).mockReturnValue({
    user: makeUser(role, workspaceType),
    token: "tok",
    loading: false,
    signIn: vi.fn(),
    signOut: vi.fn(),
    updateUser: vi.fn(),
    isImpersonating: false,
    impersonate: vi.fn(),
    exitImpersonation: vi.fn(),
  });
}

// Both the mobile drawer and the desktop rail are always mounted (mobile is only
// CSS-transformed off-screen, not unmounted — and jsdom doesn't evaluate the
// `lg:hidden` media-query breakpoint, so both are "visible" to RTL queries).
// Every assertion below scopes to the desktop aside via its `data-testid` to
// avoid ambiguous "found 2 elements" failures from the duplicated mobile copy,
// except the one test that specifically checks the mobile drawer's own content.
function renderSidebar(initialPath = "/") {
  const { unmount } = render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Sidebar />
    </MemoryRouter>,
  );
  return { desktop: within(screen.getByTestId("sidebar-desktop")), unmount };
}

describe("Sidebar", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mockAs("DIRECTOR", "EDTECH");
    vi.mocked(leadStatsCtx.useLeadStats).mockReturnValue({
      stats: [],
      total: 0,
      orgTotal: 0,
      mtdTotal: 42,
      loading: false,
      refresh: vi.fn(),
    });
    vi.mocked(themeCtx.useTheme).mockReturnValue({ theme: "light", toggleTheme: vi.fn(), setTheme: vi.fn() });
  });

  it("renders the EdTech groups for an EDTECH org, with the MTD badge on Leads", () => {
    const { desktop } = renderSidebar();
    expect(desktop.getByText("Enrolment")).toBeInTheDocument();
    expect(desktop.getByText("Finance")).toBeInTheDocument();
    expect(desktop.getByText("42")).toBeInTheDocument();
  });

  it("renders the Manufacturing groups for a MANUFACTURING org", () => {
    mockAs("DIRECTOR", "MANUFACTURING");
    // jsdom is 1024px wide, which is the Manufacturing icon-rail band; groups show at full width.
    const prevWidth = window.innerWidth;
    window.innerWidth = 1280;
    try {
      const { desktop } = renderSidebar();
      expect(desktop.getByText("Customers")).toBeInTheDocument();
      expect(desktop.getByText("Deals")).toBeInTheDocument();
    } finally {
      window.innerWidth = prevWidth;
    }
  });

  it("hides role-gated groups entirely for a SALES_REP", () => {
    mockAs("SALES_REP", "EDTECH");
    const { desktop } = renderSidebar();
    // Workspace group's items are all DIRECTOR/MANAGER/DIRECTOR-only — group should not render.
    expect(desktop.queryByText("Workspace")).not.toBeInTheDocument();
  });

  it("shows groups open by default on a fresh load with no prior localStorage state", () => {
    // Preserves the pre-Phase-1 flat list's effectively-always-visible items
    // for a user who has never touched the sidebar before.
    const { desktop } = renderSidebar();
    expect(desktop.getByText("Courses")).toBeInTheDocument();
    expect(desktop.getByText("Payments")).toBeInTheDocument();
  });

  it("toggling a group closed persists across a remount", () => {
    const { desktop, unmount } = renderSidebar();
    expect(desktop.getByText("Courses")).toBeInTheDocument();
    fireEvent.click(desktop.getByRole("button", { name: /enrolment/i }));
    expect(desktop.queryByText("Courses")).not.toBeInTheDocument();
    unmount();

    // Fresh mount — proves persistence survived via localStorage, not React state.
    const { desktop: desktop2 } = renderSidebar();
    expect(desktop2.queryByText("Courses")).not.toBeInTheDocument();
  });

  it("auto-opens the group containing the active route", () => {
    const { desktop } = renderSidebar("/nurturing");
    expect(desktop.getByText("Nurturing")).toBeInTheDocument();
  });

  it("auto-opens the group for a detail route via prefix match, not just exact match", () => {
    // Simulate a user who has explicitly closed every group before (an empty
    // persisted `openGroups`), so the group's visibility genuinely depends on
    // the active-route effect rather than the new default-open seeding.
    localStorage.setItem("sidebarNavState", JSON.stringify({ collapsed: false, openGroups: [] }));
    const { desktop } = renderSidebar("/payments/some-id");
    expect(desktop.getByText("Payments")).toBeInTheDocument();
  });

  it("filters across groups via search and shows 'No pages match' for no hits", () => {
    const { desktop } = renderSidebar();
    const search = desktop.getByPlaceholderText(/find a page/i);
    fireEvent.change(search, { target: { value: "zzzzz" } });
    expect(desktop.getByText(/no pages match/i)).toBeInTheDocument();

    fireEvent.change(search, { target: { value: "cour" } });
    expect(desktop.getByText("Courses")).toBeInTheDocument();
  });

  it("does not show 'No pages match' when a pinned item matches, even with zero group matches", () => {
    const { desktop } = renderSidebar();
    const search = desktop.getByPlaceholderText(/find a page/i);
    fireEvent.change(search, { target: { value: "dash" } });
    expect(desktop.getByText("Dashboard")).toBeInTheDocument();
    expect(desktop.queryByText(/no pages match/i)).not.toBeInTheDocument();
  });

  it("shows 'No pages match' when a search hit role-filters down to zero visible items", () => {
    // "Billing" only lives in the Workspace group and is DIRECTOR-only.
    // SidebarSearch (role-unaware) matches it, but SidebarGroup then role-filters
    // it away for a SALES_REP — the top-level message must still fire instead
    // of leaving an ambiguous blank area.
    mockAs("SALES_REP", "EDTECH");
    const { desktop } = renderSidebar();
    const search = desktop.getByPlaceholderText(/find a page/i);
    fireEvent.change(search, { target: { value: "billing" } });
    expect(desktop.getByText(/no pages match/i)).toBeInTheDocument();
  });

  it("collapsing hides labels and switches to the icon rail", () => {
    const { desktop } = renderSidebar();
    fireEvent.click(desktop.getByRole("button", { name: /collapse/i }));
    expect(desktop.queryByText("Dashboard")).not.toBeInTheDocument();
    expect(desktop.getByRole("link", { name: /dashboard/i })).toBeInTheDocument();
  });

  it("keeps the mobile drawer fully expanded even when the desktop rail is collapsed", () => {
    const { desktop } = renderSidebar();
    // The Collapse toggle only renders in the desktop aside (renderSidebarContent
    // skips it when forceExpanded is true), so this is unambiguous even unscoped.
    fireEvent.click(desktop.getByRole("button", { name: /collapse/i }));
    // The mobile drawer's own dialog region must still show text labels — query
    // within the `role="dialog"` aside specifically, since the desktop aside is
    // now legitimately showing icons only.
    const mobileDrawer = within(screen.getByRole("dialog", { name: /navigation/i }));
    expect(mobileDrawer.getByText("Dashboard")).toBeInTheDocument();
  });

  it("closes the mobile drawer on navigating to a grouped link, not just pinned items", () => {
    renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: /open navigation/i }));
    const mobileDrawer = within(screen.getByRole("dialog", { name: /navigation/i }));
    // The overlay only renders while the drawer is open.
    expect(document.querySelector(".bg-black\\/60")).toBeInTheDocument();

    fireEvent.click(mobileDrawer.getByRole("link", { name: /courses/i }));
    expect(document.querySelector(".bg-black\\/60")).not.toBeInTheDocument();
  });
});
