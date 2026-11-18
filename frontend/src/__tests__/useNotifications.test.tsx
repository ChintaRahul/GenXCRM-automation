import React from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  NotificationsProvider,
  useNotifications,
} from "../context/NotificationsContext";
import { LeadStatsProvider } from "../context/LeadStatsContext";
import * as client from "../api/client";
import { toast } from "sonner";

vi.mock("../api/client");
vi.mock("sonner", () => ({ toast: vi.fn() }));
vi.mock("../context/AuthContext", () => {
  // Stable reference so the provider's [user] effect doesn't re-run every render.
  const user = { id: "u1", name: "Rep", role: "SALES_REP" };
  return { useAuth: () => ({ user }) };
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <LeadStatsProvider>
    <NotificationsProvider>{children}</NotificationsProvider>
  </LeadStatsProvider>
);

// Anchors are seeded in the past so the mocked leads (created after) read as unread.
const PAST = "2020-01-01T00:00:00.000Z";
const lead = (id: string, name: string, updatedAt = "2025-01-01T00:00:00.000Z") => ({
  id,
  name,
  source: "FACEBOOK",
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt,
});
const seedAnchors = () => {
  localStorage.setItem("genx:lead-lastseen:u1", PAST);
  localStorage.setItem("genx:lead-listsince:u1", PAST);
};

describe("useNotifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("surfaces unread count and leads from a successful poll (queried by listSince)", async () => {
    seedAnchors();
    vi.mocked(client.getRecentLeads).mockResolvedValue({
      count: 2,
      leads: [lead("l1", "Alice"), lead("l2", "Bob")],
    });
    const { result } = renderHook(() => useNotifications(), { wrapper });
    await waitFor(() => expect(result.current.count).toBe(2));
    expect(result.current.leads).toHaveLength(2);
    expect(result.current.leads[0].name).toBe("Alice");
    expect(client.getRecentLeads).toHaveBeenCalledWith(PAST);
  });

  it("clears the badge but KEEPS the list on markSeen", async () => {
    seedAnchors();
    vi.mocked(client.getRecentLeads).mockResolvedValue({
      count: 3,
      leads: [lead("l1", "Alice"), lead("l2", "Bob"), lead("l3", "Cara")],
    });
    const { result } = renderHook(() => useNotifications(), { wrapper });
    await waitFor(() => expect(result.current.count).toBe(3));
    act(() => result.current.markSeen());
    expect(result.current.count).toBe(0);
    // The list must remain visible — only an explicit clear() empties it.
    expect(result.current.leads).toHaveLength(3);
  });

  it("empties the list and resets the count on clear", async () => {
    seedAnchors();
    vi.mocked(client.getRecentLeads).mockResolvedValue({
      count: 2,
      leads: [lead("l1", "Alice")],
    });
    const { result } = renderHook(() => useNotifications(), { wrapper });
    await waitFor(() => expect(result.current.leads).toHaveLength(1));
    act(() => result.current.clear());
    expect(result.current.count).toBe(0);
    expect(result.current.leads).toHaveLength(0);
  });

  it("leaves the count intact on a failed poll", async () => {
    vi.mocked(client.getRecentLeads).mockRejectedValue(new Error("Network"));
    const { result } = renderHook(() => useNotifications(), { wrapper });
    await waitFor(() => expect(client.getRecentLeads).toHaveBeenCalled());
    expect(result.current.count).toBe(0);
  });

  it("refreshes lead stats and bumps newLeadVersion when a new lead is found", async () => {
    seedAnchors();
    vi.mocked(client.getStageStats).mockResolvedValue([
      { stage: "NEW", _count: { stage: 5 } },
    ]);
    vi.mocked(client.getRecentLeads).mockResolvedValue({
      count: 1,
      leads: [lead("l1", "Alice")],
    });
    const { result } = renderHook(() => useNotifications(), { wrapper });
    await waitFor(() => expect(result.current.newLeadVersion).toBe(1));
    // Each LeadStatsContext.refresh() call fires 3 getStageStats requests
    // (filtered, unfiltered orgTotal, MTD) — once on LeadStatsProvider mount,
    // and again from the poll's refresh() after detecting the new lead.
    await waitFor(() =>
      expect(client.getStageStats).toHaveBeenCalledTimes(6),
    );
  });

  it("re-announces the same lead when it's resubmitted (updatedAt bumped)", async () => {
    seedAnchors();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      vi.mocked(client.getRecentLeads)
        .mockResolvedValueOnce({
          count: 1,
          leads: [lead("l1", "Alice", "2025-06-01T00:00:00.000Z")],
        })
        .mockResolvedValueOnce({
          count: 1,
          // Same lead id, but resubmitted — updatedAt bumped to a later timestamp.
          leads: [lead("l1", "Alice", "2025-06-01T00:05:00.000Z")],
        });

      const { result } = renderHook(() => useNotifications(), { wrapper });
      await vi.waitFor(() => expect(result.current.count).toBe(1));
      expect(toast).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(30_000);
      await vi.waitFor(() => expect(client.getRecentLeads).toHaveBeenCalledTimes(2));
      // The resubmission (new updatedAt) must trigger a fresh toast, not be suppressed
      // as an already-seen id.
      expect(toast).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not re-toast an already-toasted lead after a provider remount (SCRUM-3)", async () => {
    seedAnchors();
    vi.mocked(client.getRecentLeads).mockResolvedValue({
      count: 1,
      leads: [lead("l1", "Aarav Rao", "2025-06-01T00:00:00.000Z")],
    });

    const { result, unmount } = renderHook(() => useNotifications(), { wrapper });
    await waitFor(() => expect(result.current.count).toBe(1));
    expect(toast).toHaveBeenCalledTimes(1);

    // Simulate a hard refresh / full remount: the provider (and its in-memory
    // toastedRef) is torn down and recreated, but localStorage anchors persist —
    // lastSeen is still the same stale value since the user never opened the bell.
    unmount();
    const { result: result2 } = renderHook(() => useNotifications(), { wrapper });
    await waitFor(() => expect(result2.current.count).toBe(1));

    // The lead is still unread (badge shows it), but it must not be toasted again.
    expect(toast).toHaveBeenCalledTimes(1);
  });
});
