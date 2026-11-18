import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';
import { requireOrgId } from '../../modules-framework/utils/require-org-id.util';

export interface NotificationListResult {
  data: { id: string; title: string; body: string; link: string | null; isRead: boolean; createdAt: Date }[];
  unreadCount: number;
}

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  // The current user's most recent notifications, plus their unread count for the bell badge.
  async findAllForCaller(caller: AuthUser, limit = 20): Promise<NotificationListResult> {
    const where = { orgId: requireOrgId(caller), userId: caller.id };
    const [data, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: { id: true, title: true, body: true, link: true, isRead: true, createdAt: true },
      }),
      this.prisma.notification.count({ where: { ...where, isRead: false } }),
    ]);
    return { data, unreadCount };
  }

  async markRead(id: string, caller: AuthUser): Promise<void> {
    const notification = await this.prisma.notification.findFirst({
      where: { id, orgId: requireOrgId(caller), userId: caller.id },
    });
    if (!notification) throw new NotFoundException(`Notification '${id}' not found.`);
    await this.prisma.notification.update({ where: { id }, data: { isRead: true } });
  }

  async markAllRead(caller: AuthUser): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { orgId: requireOrgId(caller), userId: caller.id, isRead: false },
      data: { isRead: true },
    });
  }

  // Called by SlaEngineService (and any future in-app-channel caller) to actually land a
  // notification for a user, rather than the escalation just being logged and dropped.
  async create(orgId: string, userId: string, title: string, body: string, link?: string): Promise<void> {
    await this.prisma.notification.create({ data: { orgId, userId, title, body, link } });
  }

  // Lands the notification unless this user already has one with the same title for the same link,
  // so a recurring sweep alerts once per record instead of every hour.
  async createOnce(orgId: string, userId: string, title: string, body: string, link: string): Promise<void> {
    const existing = await this.prisma.notification.findFirst({ where: { orgId, userId, title, link }, select: { id: true } });
    if (!existing) await this.create(orgId, userId, title, body, link);
  }
}
