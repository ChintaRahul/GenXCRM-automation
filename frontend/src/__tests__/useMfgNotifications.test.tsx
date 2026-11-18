import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useMfgNotifications } from "../hooks/useMfgNotifications";
import * as notificationsApi from "../api/notifications";

vi.mock("../api/notifications");

const SAMPLE = {
  data: [{ id: "n1", title: "SLA alert", body: "Breached 2h", link: "/opportunities/OP-1", isRead: false, createdAt: "2026-10-01T00:00:00Z" }],
  unreadCount: 1,
};

describe("useMfgNotifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads notifications and unread count on mount", async () => {
    vi.mocked(notificationsApi.getNotifications).mockResolvedValue(SAMPLE);
    const { result } = renderHook(() => useMfgNotifications());
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.unreadCount).toBe(1);
  });

  it("markRead optimistically marks the item read and decrements the count, then calls the API", async () => {
    vi.mocked(notificationsApi.getNotifications).mockResolvedValue(SAMPLE);
    vi.mocked(notificationsApi.markNotificationRead).mockResolvedValue(undefined);
    const { result } = renderHook(() => useMfgNotifications());
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    await act(async () => {
      await result.current.markRead("n1");
    });

    expect(result.current.unreadCount).toBe(0);
    expect(result.current.items[0].isRead).toBe(true);
    expect(notificationsApi.markNotificationRead).toHaveBeenCalledWith("n1");
  });

  it("markAllRead marks every item read and resets the count", async () => {
    vi.mocked(notificationsApi.getNotifications).mockResolvedValue(SAMPLE);
    vi.mocked(notificationsApi.markAllNotificationsRead).mockResolvedValue(undefined);
    const { result } = renderHook(() => useMfgNotifications());
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    await act(async () => {
      await result.current.markAllRead();
    });

    expect(result.current.unreadCount).toBe(0);
    expect(result.current.items.every((n) => n.isRead)).toBe(true);
    expect(notificationsApi.markAllNotificationsRead).toHaveBeenCalled();
  });
});
