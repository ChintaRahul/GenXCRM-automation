import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useFollowUps } from "../hooks/useFollowUps";
import { bucketOf, groupFollowUps } from "../lib/followUps";
import * as client from "../api/client";

vi.mock("../api/client");
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const NOW = new Date(2026, 10, 18, 10, 0, 0); // 18 Nov 2026, 10:00 local
const row = (id: string, at: Date) => ({
  id,
  name: `Lead ${id}`,
  stage: "FOLLOW_UP_REQUIRED",
  followUpAt: at.toISOString(),
  followUpNote: null,
  assignedTo: null,
});

describe("follow-up grouping", () => {
  it("buckets by the viewer's calendar day", () => {
    expect(bucketOf(new Date(2026, 10, 17, 23, 0).toISOString(), NOW)).toBe("overdue");
    expect(bucketOf(new Date(2026, 10, 18, 8, 0).toISOString(), NOW)).toBe("today");
    expect(bucketOf(new Date(2026, 10, 18, 23, 59).toISOString(), NOW)).toBe("today");
    expect(bucketOf(new Date(2026, 10, 19, 0, 0).toISOString(), NOW)).toBe("upcoming");
  });

  it("groups a list", () => {
    const groups = groupFollowUps(
      [row("a", new Date(2026, 10, 16)), row("b", new Date(2026, 10, 18, 15)), row("c", new Date(2026, 10, 20))],
      NOW,
    );
    expect(groups.overdue.map((r) => r.id)).toEqual(["a"]);
    expect(groups.today.map((r) => r.id)).toEqual(["b"]);
    expect(groups.upcoming.map((r) => r.id)).toEqual(["c"]);
  });
});

describe("useFollowUps", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns follow-ups on a successful fetch", async () => {
    vi.mocked(client.getFollowUps).mockResolvedValue([row("a", NOW)]);
    const { result } = renderHook(() => useFollowUps());
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.error).toBeNull();
  });

  it("sets error state on a failed fetch", async () => {
    vi.mocked(client.getFollowUps).mockRejectedValue(new Error("Network error"));
    const { result } = renderHook(() => useFollowUps());
    await waitFor(() => expect(result.current.error).toBeTruthy());
  });

  it("marks a follow-up done by clearing its date, then refreshes", async () => {
    vi.mocked(client.getFollowUps).mockResolvedValue([row("a", NOW)]);
    vi.mocked(client.updateLead).mockResolvedValue({} as never);
    const { result } = renderHook(() => useFollowUps());
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    await act(async () => { await result.current.markDone("a"); });
    expect(client.updateLead).toHaveBeenCalledWith("a", { followUpAt: null });
    expect(client.getFollowUps).toHaveBeenCalledTimes(2);
  });

  it("snoozes to a future time", async () => {
    vi.mocked(client.getFollowUps).mockResolvedValue([row("a", NOW)]);
    vi.mocked(client.updateLead).mockResolvedValue({} as never);
    const { result } = renderHook(() => useFollowUps());
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    await act(async () => { await result.current.snooze("a"); });
    const [, payload] = vi.mocked(client.updateLead).mock.calls[0];
    expect(new Date(payload.followUpAt as string).getTime()).toBeGreaterThan(Date.now());
  });
});
