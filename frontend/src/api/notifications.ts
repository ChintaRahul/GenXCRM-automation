import api from "./client";

export interface MfgNotification {
  id: string;
  title: string;
  body: string;
  link: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface MfgNotificationList {
  data: MfgNotification[];
  unreadCount: number;
}

export async function getNotifications(): Promise<MfgNotificationList> {
  const { data } = await api.get<MfgNotificationList>("/notifications");
  return data;
}

export async function markNotificationRead(id: string): Promise<void> {
  await api.post(`/notifications/${id}/read`);
}

export async function markAllNotificationsRead(): Promise<void> {
  await api.post("/notifications/read-all");
}
