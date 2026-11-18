import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, NavLink, useLocation } from "react-router-dom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ProductTour } from "../components/shared/ProductTour";
import { useProductTour } from "../hooks/useProductTour";
import { allowedRoutes, neighbourStep, TOURS } from "../components/onboarding/tourSteps";
import { hasAuthenticatedBefore, markAuthenticated, readTourRecord, writeTourRecord } from "../lib/firstRun";

vi.mock("../context/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("../hooks/useReadableModules", () => ({ useReadableModules: vi.fn(() => null) }));

import * as authCtx from "../context/AuthContext";

// jsdom has no layout, so give every element a visible box — the tour ignores targets with no size.
const BOX = { width: 100, height: 40, top: 100, left: 20, right: 120, bottom: 140, x: 20, y: 100, toJSON: () => ({}) };

const mockAuth = (overrides: { isImpersonating?: boolean } = {}) =>
  vi.mocked(authCtx.useAuth).mockReturnValue({
    user: { id: "u1", name: "Priya Menon", org: { workspaceType: "MANUFACTURING" } },
    isImpersonating: false,
    ...overrides,
  } as unknown as ReturnType<typeof authCtx.useAuth>);

// A stand-in app shell: sidebar links (behind a drawer on phones), a <main> with a records
// region, and the tour wired exactly like Layout does.
function Shell({ drawer = false }: { drawer?: boolean }) {
  const [navOpen, setNavOpen] = useState(false);
  const tour = useProductTour(setNavOpen);
  const { pathname } = useLocation();
  return (
    <>
      {drawer && (
        <button aria-label="Open navigation" onClick={() => setNavOpen(true)}>
          menu
        </button>
      )}
      {(!drawer || navOpen) && (
        <aside>
          <NavLink to="/">Dashboard</NavLink>
          <NavLink to="/leads">Leads</NavLink>
          <button data-tour-group="Customers">Customers</button>
          <NavLink to="/accounts">Accounts</NavLink>
        </aside>
      )}
      <main>
        <div data-tour="records">rows</div>
        <div data-tour="chips">chips</div>
      </main>
      <span data-testid="path">{pathname}</span>
      <ProductTour tour={tour} navOpen={navOpen} />
    </>
  );
}

const renderShell = (props: { drawer?: boolean } = {}) =>
  render(
    <MemoryRouter initialEntries={["/"]}>
      <Shell {...props} />
    </MemoryRouter>,
  );

const startTour = async () => {
  await userEvent.click(screen.getByRole("button", { name: /Start the tour/ }));
  await screen.findByRole("heading", { name: "This is your dashboard" });
};
const clickNext = async () => userEvent.click(await screen.findByRole("button", { name: /Next/ }));

describe("ProductTour", () => {
  beforeEach(() => {
    localStorage.clear();
    mockAuth();
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(BOX as DOMRect);
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("welcomes a new user by name and 'Not now' hides the launcher for good", async () => {
    renderShell();
    expect(screen.getByRole("heading", { name: "Welcome to GenX CRM, Priya" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("button", { name: /Take the tour/ })).toBeNull();
    expect(readTourRecord("u1")).toEqual({ i: 0, done: false, hidden: true });
  });

  it("does not auto-open while impersonating", () => {
    mockAuth({ isImpersonating: true });
    renderShell();
    expect(screen.queryByRole("heading", { name: /Welcome to GenX CRM/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Take the tour/ })).toBeNull();
  });

  it("a click step advances when the user navigates to its route", async () => {
    renderShell();
    await startTour();
    await clickNext();
    expect(await screen.findByRole("heading", { name: "Open Leads" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("link", { name: "Leads" }));
    expect(await screen.findByRole("heading", { name: "Your lead list" })).toBeInTheDocument();
    expect(screen.getByTestId("path")).toHaveTextContent("/leads");
  });

  it("Back skips click steps and returns to the previous info step's route", async () => {
    renderShell();
    await startTour();
    await clickNext();
    await userEvent.click(await screen.findByRole("link", { name: "Leads" }));
    await screen.findByRole("heading", { name: "Your lead list" });

    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("heading", { name: "This is your dashboard" })).toBeInTheDocument();
    expect(screen.getByTestId("path")).toHaveTextContent("/");
  });

  it("Skip tour keeps the place but hides the launcher", async () => {
    renderShell();
    await startTour();
    await clickNext();
    await userEvent.click(await screen.findByRole("link", { name: "Leads" }));
    await screen.findByRole("heading", { name: "Your lead list" });

    await userEvent.click(screen.getByRole("button", { name: "Skip tour" }));
    expect(readTourRecord("u1")).toMatchObject({ done: false, hidden: true });
    expect(screen.queryByRole("button", { name: /Resume tour/ })).toBeNull();
  });

  it("Esc dismisses the tour", async () => {
    renderShell();
    await startTour();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(readTourRecord("u1")).toMatchObject({ hidden: true }));
    expect(screen.queryByRole("button", { name: /Resume tour/ })).toBeNull();
  });

  it("drawer mode points at the menu button first, then at the link once the drawer is open", async () => {
    renderShell({ drawer: true });
    await startTour();
    await clickNext();
    await screen.findByRole("heading", { name: "Open Leads" });
    expect(await screen.findByText("menu", { selector: "strong" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(await screen.findByText("Leads", { selector: "strong" })).toBeInTheDocument();
  });

  it("'Take me there' jumps to the step's route, which advances the tour", async () => {
    renderShell();
    await startTour();
    await clickNext();
    await userEvent.click(await screen.findByRole("link", { name: "Leads" }));
    await clickNext();
    await clickNext();
    expect(await screen.findByRole("heading", { name: "Open Accounts" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Take me there" }));
    await waitFor(() => expect(screen.getByTestId("path")).toHaveTextContent("/accounts"));
    expect(await screen.findByRole("heading", { name: "Customer accounts" })).toBeInTheDocument();
  });
});

describe("tour steps", () => {
  it("skips steps for modules the role can't read", () => {
    const { steps } = TOURS.MANUFACTURING;
    const allowed = allowedRoutes("MANUFACTURING", ["leads", "opps"]);
    const accNav = steps.findIndex((s) => s.k === "acc-nav");
    // From the end of the Leads chapter the next stop is Opportunities, not Accounts.
    expect(steps[neighbourStep(steps, accNav - 1, 1, allowed)].k).toBe("opp-nav");
  });

  it("Back targets only info steps", () => {
    const { steps } = TOURS.MANUFACTURING;
    const allowed = allowedRoutes("MANUFACTURING", null);
    const oppNav = steps.findIndex((s) => s.k === "opp-nav");
    expect(steps[neighbourStep(steps, oppNav, -1, allowed, true)].k).toBe("acc-list");
  });
});

describe("firstRun", () => {
  beforeEach(() => localStorage.clear());
  it("tracks first authentication", () => {
    expect(hasAuthenticatedBefore()).toBe(false);
    markAuthenticated();
    expect(hasAuthenticatedBefore()).toBe(true);
  });
  it("stores tour progress per user and ignores corrupt data", () => {
    writeTourRecord("u1", { i: 4, done: false });
    expect(readTourRecord("u1")).toEqual({ i: 4, done: false, hidden: false });
    expect(readTourRecord("u2")).toBeNull();
    localStorage.setItem("genx-tour-v1:u3", "{nope");
    expect(readTourRecord("u3")).toBeNull();
  });
});
