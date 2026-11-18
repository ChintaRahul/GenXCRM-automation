import { useCallback, useEffect, useState } from "react";
import { getNotifications, markAllNotificationsRead, markNotificationRead, type MfgNotification } from "../api/notifications";
import { startVisiblePolling } from "../lib/visiblePolling";

const POLL_INTERVAL_MS = 30_000;

// The Manufacturing-workspace counterpart to NotificationsContext (which is EdTech's
// new-leads bell) — backs the header bell with the generic Notification inbox that
// SlaEngineService's 'In-app' escalation channel writes to (see README §SLA engine).
export function useMfgNotifications() {
  const [items, setItems] = useState<MfgNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const refresh = useCallback(async () => {
    const result = await getNotifications();
    setItems(result.data);
    setUnreadCount(result.unreadCount);
  }, []);

  useEffect(() => startVisiblePolling(refresh, POLL_INTERVAL_MS), [refresh]);

  const markRead = useCallback(async (id: string) => {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
    setUnreadCount((c) => Math.max(0, c - 1));
    await markNotificationRead(id);
  }, []);

  const markAllRead = useCallback(async () => {
    setItems((prev) => prev.map((n) => ({ ...n, isRead: true })));
    setUnreadCount(0);
    await markAllNotificationsRead();
  }, []);

  return { items, unreadCount, refresh, markRead, markAllRead };
}
