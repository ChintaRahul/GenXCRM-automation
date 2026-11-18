import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import { FollowUpRemindersService, orgClock, orgDayStart } from './follow-up-reminders.service';

describe('orgClock / orgDayStart', () => {
  it('reads the date and hour in the org timezone', () => {
    // 2026-11-18 04:00 UTC is 09:30 in Kolkata
    expect(orgClock('Asia/Kolkata', new Date('2026-11-18T04:00:00Z'))).toEqual({ date: '2026-11-18', hour: 9, weekday: 'Wed' });
  });

  it('finds the instant an org-local day begins', () => {
    expect(orgDayStart('2026-11-18', 'Asia/Kolkata').toISOString()).toBe('2026-11-17T18:30:00.000Z');
    expect(orgDayStart('2026-11-18', 'UTC').toISOString()).toBe('2026-11-18T00:00:00.000Z');
  });
});

describe('FollowUpRemindersService', () => {
  let service: FollowUpRemindersService;
  const prisma = {
    organization: { findMany: jest.fn(), update: jest.fn() },
    user: { findMany: jest.fn() },
    lead: { count: jest.fn() },
    mfgActivity: { count: jest.fn() },
  };
  const mail = { send: jest.fn() };
  const notifications = { createOnce: jest.fn() };
  const NOW = new Date('2026-11-18T04:00:00Z'); // 09:30 in Kolkata

  const org = (over: Record<string, unknown> = {}) => ({
    id: 'org-1',
    timezone: 'Asia/Kolkata',
    workspaceType: 'EDTECH',
    notificationSettings: { followUpReminders: { enabled: true, email: true, inApp: true } },
    followUpDigestSentOn: null,
    ...over,
  });
  const rep = { id: 'u1', name: 'Priya', email: 'p@x.com', role: 'SALES_REP', teamId: null };

  beforeEach(async () => {
    jest.resetAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        FollowUpRemindersService,
        { provide: PrismaService, useValue: prisma },
        { provide: MailService, useValue: mail },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();
    service = module.get(FollowUpRemindersService);
    prisma.user.findMany.mockResolvedValue([rep]);
    prisma.lead.count.mockResolvedValueOnce(4).mockResolvedValueOnce(7);
  });

  it('sends nothing when the org has not opted in (default off)', async () => {
    prisma.organization.findMany.mockResolvedValue([org({ notificationSettings: null })]);
    await service.sendDueDigests(NOW);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('waits until 9:00 org time', async () => {
    prisma.organization.findMany.mockResolvedValue([org()]);
    await service.sendDueDigests(new Date('2026-11-18T02:00:00Z')); // 07:30 Kolkata
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('sends once per org-local day', async () => {
    prisma.organization.findMany.mockResolvedValue([org({ followUpDigestSentOn: '2026-11-18' })]);
    await service.sendDueDigests(NOW);
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('notifies and emails a rep with their own overdue and due-today counts, scoped to org and rep', async () => {
    prisma.organization.findMany.mockResolvedValue([org()]);
    await service.sendDueDigests(NOW);
    expect(prisma.organization.update).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      data: { followUpDigestSentOn: '2026-11-18' },
    });
    expect(prisma.lead.count).toHaveBeenCalledWith({
      where: expect.objectContaining({ orgId: 'org-1', assignedToId: 'u1', isDeleted: false }),
    });
    expect(notifications.createOnce).toHaveBeenCalledWith(
      'org-1', 'u1', '11 follow-ups today', '4 overdue, 7 due today.', '/dashboard',
    );
    expect(mail.send).toHaveBeenCalledWith('p@x.com', expect.stringContaining('11 follow-ups'), expect.any(String));
  });

  it('respects the per-channel switches', async () => {
    prisma.organization.findMany.mockResolvedValue([
      org({ notificationSettings: { followUpReminders: { enabled: true, email: false, inApp: true } } }),
    ]);
    await service.sendDueDigests(NOW);
    expect(notifications.createOnce).toHaveBeenCalled();
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('stays off when the switch is off even if channels are set', async () => {
    prisma.organization.findMany.mockResolvedValue([
      org({ notificationSettings: { followUpReminders: { enabled: false, email: true, inApp: true } } }),
    ]);
    await service.sendDueDigests(NOW);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('honours the configured send hour', async () => {
    prisma.organization.findMany.mockResolvedValue([
      org({ notificationSettings: { followUpReminders: { enabled: true, sendHour: 10 } } }),
    ]);
    await service.sendDueDigests(NOW); // 09:30 Kolkata, before 10:00
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('skips Sundays when asked, and sends on Sundays when not', async () => {
    const sunday = new Date('2026-11-22T04:00:00Z'); // Sunday 09:30 Kolkata
    prisma.organization.findMany.mockResolvedValue([org()]);
    await service.sendDueDigests(sunday);
    expect(prisma.user.findMany).not.toHaveBeenCalled();

    prisma.organization.findMany.mockResolvedValue([
      org({ notificationSettings: { followUpReminders: { enabled: true, skipSundays: false } } }),
    ]);
    await service.sendDueDigests(sunday);
    expect(prisma.user.findMany).toHaveBeenCalled();
  });

  it('only sends to the chosen roles', async () => {
    prisma.organization.findMany.mockResolvedValue([
      org({ notificationSettings: { followUpReminders: { enabled: true, reps: false, managers: true } } }),
    ]);
    await service.sendDueDigests(NOW);
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1', role: { in: ['MANAGER'] } }) }),
    );
  });

  it('leaves out the groups the admin did not include', async () => {
    prisma.organization.findMany.mockResolvedValue([
      org({ notificationSettings: { followUpReminders: { enabled: true, overdue: false } } }),
    ]);
    await service.sendDueDigests(NOW);
    expect(notifications.createOnce).toHaveBeenCalledWith('org-1', 'u1', '7 follow-ups today', '7 due today.', '/dashboard');
  });

  it('skips people with nothing due', async () => {
    prisma.lead.count.mockReset().mockResolvedValue(0);
    prisma.organization.findMany.mockResolvedValue([org()]);
    await service.sendDueDigests(NOW);
    expect(mail.send).not.toHaveBeenCalled();
    expect(notifications.createOnce).not.toHaveBeenCalled();
  });

  it('uses open activities for Manufacturing workspaces', async () => {
    prisma.mfgActivity.count.mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    prisma.organization.findMany.mockResolvedValue([org({ workspaceType: 'MANUFACTURING' })]);
    await service.sendDueDigests(NOW);
    expect(prisma.mfgActivity.count).toHaveBeenCalledWith({
      where: expect.objectContaining({ orgId: 'org-1', ownerId: 'u1', status: 'Open' }),
    });
    expect(prisma.lead.count).not.toHaveBeenCalled();
    expect(notifications.createOnce).toHaveBeenCalledWith('org-1', 'u1', '3 follow-ups today', expect.any(String), '/dashboard');
  });
});
