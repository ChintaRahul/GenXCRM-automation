import { render, screen, fireEvent, act, renderHook, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { Sidebar } from "../components/layout/Sidebar";
import { MobileTopBar } from "../components/layout/MobileTopBar";
import { ModuleCardList } from "../components/module/ModuleCardList";
import { modeForWidth, useViewportMode } from "../hooks/useViewportMode";
import { REGISTRY } from "../modules/registry";
import type { Role, User, WorkspaceType } from "../types";

vi.mock("../context/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("../context/LeadStatsContext", () => ({ useLeadStats: vi.fn() }));
vi.mock("../lib/theme", () => ({ useTheme: vi.fn() }));

import * as authCtx from "../context/AuthContext";
import * as leadStatsCtx from "../context/LeadStatsContext";
import * as themeCtx from "../lib/theme";

const makeUser = (role: Role, workspaceType: WorkspaceType): User => ({
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
});

const mockAs = (workspaceType: WorkspaceType) =>
  vi.mocked(authCtx.useAuth).mockReturnValue({
    user: makeUser("DIRECTOR", workspaceType),
    token: "tok",
    loading: false,
    signIn: vi.fn(),
    signOut: vi.fn(),
    updateUser: vi.fn(),
    isImpersonating: false,
    impersonate: vi.fn(),
    exitImpersonation: vi.fn(),
  });

const originalWidth = window.innerWidth;
const setWidth = (width: number) => {
  window.innerWidth = width;
  act(() => {
    window.dispatchEvent(new Event("resize"));
  });
};

beforeEach(() => {
  localStorage.clear();
  vi.mocked(leadStatsCtx.useLeadStats).mockReturnValue({
    stats: [],
    total: 0,
    orgTotal: 0,
    mtdTotal: 0,
    loading: false,
    refresh: vi.fn(),
  });
  vi.mocked(themeCtx.useTheme).mockReturnValue({ theme: "light", toggleTheme: vi.fn(), setTheme: vi.fn() });
});

afterEach(() => {
  window.innerWidth = originalWidth;
});

const renderSidebar = () =>
  render(
    <MemoryRouter>
      <Sidebar />
    </MemoryRouter>,
  );

describe("modeForWidth", () => {
  it("maps widths to full / rail / drawer at 1100 and 768", () => {
    expect(modeForWidth(1440)).toBe("full");
    expect(modeForWidth(1100)).toBe("full");
    expect(modeForWidth(1099)).toBe("rail");
    expect(modeForWidth(768)).toBe("rail");
    expect(modeForWidth(767)).toBe("drawer");
    expect(modeForWidth(375)).toBe("drawer");
  });
});

describe("useViewportMode", () => {
  it("follows window resizes", () => {
    window.innerWidth = 1280;
    const { result } = renderHook(() => useViewportMode());
    expect(result.current).toBe("full");
    setWidth(900);
    expect(result.current).toBe("rail");
    setWidth(500);
    expect(result.current).toBe("drawer");
  });
});

describe("Manufacturing sidebar modes", () => {
  beforeEach(() => mockAs("MANUFACTURING"));

  it("full (>=1100): expanded 232px sidebar with the collapse control", () => {
    window.innerWidth = 1280;
    renderSidebar();
    const aside = screen.getByTestId("sidebar-desktop");
    expect(aside.className).toContain("w-[232px]");
    expect(screen.getByRole("button", { name: /collapse sidebar/i })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("rail (768-1099): 60px icon rail that overrides a persisted expanded choice, no collapse control", () => {
    window.innerWidth = 900;
    renderSidebar();
    const aside = screen.getByTestId("sidebar-desktop");
    expect(aside.className).toContain("w-[60px]");
    expect(within(aside).queryByRole("button", { name: /collapse sidebar|expand sidebar/i })).not.toBeInTheDocument();
  });

  it("drawer (<768): no inline sidebar, an off-canvas 232px (max 86vw) drawer instead", () => {
    window.innerWidth = 600;
    renderSidebar();
    expect(screen.queryByTestId("sidebar-desktop")).not.toBeInTheDocument();
    const drawer = screen.getByRole("dialog", { hidden: true });
    expect(drawer.className).toContain("w-[232px]");
    expect(drawer.className).toContain("max-w-[86vw]");
    expect(drawer.className).toContain("-translate-x-full");
  });

  it("opens the drawer when told to and closes it from the scrim and on navigation", () => {
    window.innerWidth = 600;
    const onChange = vi.fn();
    const { container, rerender } = render(
      <MemoryRouter>
        <Sidebar mobileOpen onMobileOpenChange={onChange} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("dialog").className).toContain("translate-x-0");
    fireEvent.click(container.querySelector(".bg-black\\/60") as HTMLElement);
    expect(onChange).toHaveBeenCalledWith(false);
    rerender(
      <MemoryRouter>
        <Sidebar mobileOpen={false} onMobileOpenChange={onChange} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("dialog", { hidden: true }).className).toContain("-translate-x-full");
  });
});

describe("EdTech sidebar", () => {
  it("is unchanged at phone width: both the drawer and the CSS-hidden desktop sidebar are mounted", () => {
    mockAs("EDTECH");
    window.innerWidth = 600;
    renderSidebar();
    expect(screen.getByTestId("sidebar-desktop").className).toContain("hidden lg:flex");
    expect(screen.getByRole("dialog", { hidden: true }).className).toContain("lg:hidden");
  });
});

describe("MobileTopBar", () => {
  it("shows the menu button, logo and the current page title, and opens navigation", () => {
    mockAs("MANUFACTURING");
    const onMenu = vi.fn();
    render(
      <MemoryRouter initialEntries={["/accounts/A-1"]}>
        <MobileTopBar onMenu={onMenu} />
      </MemoryRouter>,
    );
    expect(screen.getByText("Accounts")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /open navigation/i }));
    expect(onMenu).toHaveBeenCalledOnce();
  });
});

describe("ModuleCardList", () => {
  const def = REGISTRY.accounts;
  const record = {
    id: "A-1021",
    name: "Kaveri Steel Industries",
    short: "Kaveri Steel",
    industry: "Steel & metals",
    type: "Customer",
    territory: "South",
    potential: 5000000,
    ownerId: "ad",
    status: "Active",
  };

  it("renders title, id, status pill and at most six label/value pairs, and opens the record on tap", () => {
    const onRowClick = vi.fn();
    render(<ModuleCardList records={[record]} columns={def.cols} moduleDef={def} onRowClick={onRowClick} />);
    const card = screen.getByRole("button");
    expect(within(card).getByText("Kaveri Steel")).toBeInTheDocument();
    expect(within(card).getByText("Active")).toBeInTheDocument();
    expect(card.querySelectorAll("dt").length).toBeLessThanOrEqual(6);
    fireEvent.click(card);
    expect(onRowClick).toHaveBeenCalledWith(record);
  });
});
