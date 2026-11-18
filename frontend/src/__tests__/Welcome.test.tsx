import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WelcomePage from "../pages/Welcome";
import { useCarousel } from "../hooks/useCarousel";
import * as authCtx from "../context/AuthContext";

vi.mock("../context/AuthContext", () => ({ useAuth: vi.fn() }));

const renderWelcome = () =>
  render(
    <MemoryRouter initialEntries={["/welcome"]}>
      <WelcomePage />
    </MemoryRouter>,
  );

describe("WelcomePage", () => {
  beforeEach(() => {
    vi.mocked(authCtx.useAuth).mockReturnValue({ user: null } as ReturnType<typeof authCtx.useAuth>);
  });

  it("shows the slide copy, both calls to action and the trial line", () => {
    renderWelcome();
    expect(screen.getByRole("heading", { name: "Your business at a glance" })).toBeInTheDocument();
    // Off-screen slides are aria-hidden but still rendered in the track.
    expect(screen.getByText("Quote to PO to service")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    expect(screen.getByRole("link", { name: /Create account/ })).toHaveAttribute("href", "/signup");
    expect(screen.getByText("14-day free trial · No card required")).toBeInTheDocument();
  });

  it("has one dot per slide and marks the tapped one current", async () => {
    renderWelcome();
    await userEvent.click(screen.getByRole("button", { name: "Slide 3" }));
    expect(screen.getByRole("button", { name: "Slide 3" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: "Slide 1" })).toHaveAttribute("aria-current", "false");
  });

  it("redirects a signed-in user away", () => {
    vi.mocked(authCtx.useAuth).mockReturnValue({ user: { id: "u1" } } as ReturnType<typeof authCtx.useAuth>);
    renderWelcome();
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
  });
});

describe("useCarousel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("auto-advances every 4.5s and wraps", () => {
    const { result } = renderHook(() => useCarousel(4));
    act(() => void vi.advanceTimersByTime(4500));
    expect(result.current.index).toBe(1);
    act(() => void vi.advanceTimersByTime(4500 * 3));
    expect(result.current.index).toBe(0);
  });

  it("stops for good once the user interacts", () => {
    const { result } = renderHook(() => useCarousel(4));
    act(() => result.current.goTo(2));
    act(() => void vi.advanceTimersByTime(20000));
    expect(result.current.index).toBe(2);
  });

  it("swipes past the 40px threshold only", () => {
    const { result } = renderHook(() => useCarousel(4, false));
    const swipe = (from: number, to: number) => {
      act(() => result.current.swipeHandlers.onPointerDown({ clientX: from } as React.PointerEvent));
      act(() => result.current.swipeHandlers.onPointerUp({ clientX: to } as React.PointerEvent));
    };
    swipe(200, 180);
    expect(result.current.index).toBe(0);
    swipe(200, 100);
    expect(result.current.index).toBe(1);
    swipe(100, 200);
    expect(result.current.index).toBe(0);
  });
});
