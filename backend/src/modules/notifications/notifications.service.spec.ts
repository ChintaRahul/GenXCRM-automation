import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';

const mockPrisma = {
  notification: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
};

const caller: AuthUser = { id: 'user-1', name: 'Rep', email: 'rep@test.com', role: 'SALES_REP' as never, teamId: null, orgId: 'org-1' };

describe('NotificationsService', () => {
  let service: NotificationsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [NotificationsService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get(NotificationsService);
  });

  describe('findAllForCaller', () => {
    it('scopes to the caller\'s org and userId, and returns the unread count', async () => {
      mockPrisma.notification.findMany.mockResolvedValue([{ id: 'n1', title: 'SLA alert', body: 'x', link: null, isRead: false, createdAt: new Date() }]);
      mockPrisma.notification.count.mockResolvedValue(3);
      const result = await service.findAllForCaller(caller);
      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { orgId: 'org-1', userId: 'user-1' } }),
      );
      expect(mockPrisma.notification.count).toHaveBeenCalledWith({ where: { orgId: 'org-1', userId: 'user-1', isRead: false } });
      expect(result.unreadCount).toBe(3);
      expect(result.data).toHaveLength(1);
    });
  });

  describe('markRead', () => {
    it('throws NotFoundException for a notification outside the caller\'s org/user', async () => {
      mockPrisma.notification.findFirst.mockResolvedValue(null);
      await expect(service.markRead('n1', caller)).rejects.toThrow(NotFoundException);
      expect(mockPrisma.notification.update).not.toHaveBeenCalled();
    });

    it('marks the notification read when it belongs to the caller', async () => {
      mockPrisma.notification.findFirst.mockResolvedValue({ id: 'n1', orgId: 'org-1', userId: 'user-1' });
      await service.markRead('n1', caller);
      expect(mockPrisma.notification.update).toHaveBeenCalledWith({ where: { id: 'n1' }, data: { isRead: true } });
    });
  });

  describe('markAllRead', () => {
    it('marks every unread notification for the caller as read', async () => {
      await service.markAllRead(caller);
      expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith({
        where: { orgId: 'org-1', userId: 'user-1', isRead: false },
        data: { isRead: true },
      });
    });
  });

  describe('create', () => {
    it('creates a notification row with the given fields', async () => {
      await service.create('org-1', 'user-1', 'Title', 'Body', '/opportunities/OP-1');
      expect(mockPrisma.notification.create).toHaveBeenCalledWith({
        data: { orgId: 'org-1', userId: 'user-1', title: 'Title', body: 'Body', link: '/opportunities/OP-1' },
      });
    });
  });

  it('createOnce skips a notification the user already has for that link, and creates it otherwise', async () => {
    mockPrisma.notification.findFirst.mockResolvedValueOnce({ id: 'n-1' });
    await service.createOnce('org-1', 'user-1', 'Expected close date passed', 'body', '/opportunities/op-1');
    expect(mockPrisma.notification.create).not.toHaveBeenCalled();
    mockPrisma.notification.findFirst.mockResolvedValueOnce(null);
    await service.createOnce('org-1', 'user-1', 'Expected close date passed', 'body', '/opportunities/op-1');
    expect(mockPrisma.notification.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orgId: 'org-1', userId: 'user-1', title: 'Expected close date passed', link: '/opportunities/op-1' } }),
    );
    expect(mockPrisma.notification.create).toHaveBeenCalledWith({
      data: { orgId: 'org-1', userId: 'user-1', title: 'Expected close date passed', body: 'body', link: '/opportunities/op-1' },
    });
  });
});
