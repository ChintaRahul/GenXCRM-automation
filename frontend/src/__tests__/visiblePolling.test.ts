import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startVisiblePolling } from "../lib/visiblePolling";

const setVisibility = (state: "visible" | "hidden") => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
};

describe("startVisiblePolling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setVisibility("visible");
  });
  afterEach(() => {
    vi.useRealTimers();
    setVisibility("visible");
  });

  it("polls immediately and then on every interval while the tab is visible", () => {
    const poll = vi.fn();
    const stop = startVisiblePolling(poll, 1000);
    expect(poll).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3000);
    expect(poll).toHaveBeenCalledTimes(4);
    stop();
  });

  it("makes no calls while the tab is hidden", () => {
    const poll = vi.fn();
    const stop = startVisiblePolling(poll, 1000);
    setVisibility("hidden");
    poll.mockClear();
    vi.advanceTimersByTime(10_000);
    expect(poll).not.toHaveBeenCalled();
    stop();
  });

  it("does not poll on start when the tab is already hidden, then polls once it becomes visible", () => {
    setVisibility("hidden");
    const poll = vi.fn();
    const stop = startVisiblePolling(poll, 1000);
    expect(poll).not.toHaveBeenCalled();
    setVisibility("visible");
    expect(poll).toHaveBeenCalledTimes(1);
    stop();
  });

  it("catches up immediately on return after a full interval, and resumes the schedule", () => {
    const poll = vi.fn();
    const stop = startVisiblePolling(poll, 1000);
    setVisibility("hidden");
    vi.advanceTimersByTime(5000);
    poll.mockClear();
    setVisibility("visible");
    expect(poll).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(poll).toHaveBeenCalledTimes(2);
    stop();
  });

  it("does not double-poll when the tab flickers back within one interval", () => {
    const poll = vi.fn();
    const stop = startVisiblePolling(poll, 1000);
    vi.advanceTimersByTime(400);
    setVisibility("hidden");
    setVisibility("visible");
    expect(poll).toHaveBeenCalledTimes(1);
    stop();
  });

  it("stops polling and detaches its listener on cleanup", () => {
    const poll = vi.fn();
    const stop = startVisiblePolling(poll, 1000);
    stop();
    poll.mockClear();
    vi.advanceTimersByTime(5000);
    setVisibility("hidden");
    setVisibility("visible");
    expect(poll).not.toHaveBeenCalled();
  });
});
