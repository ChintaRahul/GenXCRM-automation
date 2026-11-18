import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { IngestionAlertsService } from './ingestion-alerts.service';

describe('IngestionAlertsService', () => {
  let service: IngestionAlertsService;
  const mockPrisma = {
    ingestionFailure: { create: jest.fn(), count: jest.fn(), updateMany: jest.fn(), findMany: jest.fn(), groupBy: jest.fn() },
    organization: { findUnique: jest.fn() },
    user: { findMany: jest.fn() },
  };
  const mockMail = { send: jest.fn().mockResolvedValue(true) };
  const failure = { orgId: 'org-1', platform: 'facebook', formId: 'f-1', leadgenId: 'lg-1', reason: 'Token expired' };
  const row = { ...failure, createdAt: new Date('2026-10-18T10:00:00Z') };

  beforeEach(async () => {
    jest.resetAllMocks();
    mockMail.send.mockResolvedValue(true);
    mockPrisma.ingestionFailure.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.ingestionFailure.findMany.mockResolvedValue([row]);
    mockPrisma.organization.findUnique.mockResolvedValue({ name: 'Acme', notificationSettings: null });
    mockPrisma.user.findMany.mockResolvedValue([{ email: 'dir@acme.com' }]);
    const module = await Test.createTestingModule({
      providers: [
        IngestionAlertsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: MailService, useValue: mockMail },
      ],
    }).compile();
    service = module.get(IngestionAlertsService);
  });

  it('emails support and the org directors immediately when no alert window is open', async () => {
    mockPrisma.ingestionFailure.count.mockResolvedValue(0);
    await service.recordFailure(failure);
    expect(mockPrisma.ingestionFailure.create).toHaveBeenCalledWith({ data: failure });
    expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1', role: 'DIRECTOR' }) }),
    );
    expect(mockMail.send).toHaveBeenCalledWith('support@genxcrm.co.in', expect.stringContaining('Acme'), expect.any(String));
    expect(mockMail.send).toHaveBeenCalledWith('dir@acme.com', expect.any(String), expect.any(String));
  });

  it('only stores the failure while an alert window is open', async () => {
    mockPrisma.ingestionFailure.count.mockResolvedValue(1);
    await service.recordFailure(failure);
    expect(mockPrisma.ingestionFailure.create).toHaveBeenCalled();
    expect(mockMail.send).not.toHaveBeenCalled();
  });

  it('skips the director email when the org turned it off, but still alerts support', async () => {
    mockPrisma.ingestionFailure.count.mockResolvedValue(0);
    mockPrisma.organization.findUnique.mockResolvedValue({
      name: 'Acme',
      notificationSettings: { leadIngestionFailures: { email: false, inApp: false } },
    });
    await service.recordFailure(failure);
    expect(mockMail.send).toHaveBeenCalledTimes(1);
    expect(mockMail.send).toHaveBeenCalledWith('support@genxcrm.co.in', expect.any(String), expect.any(String));
  });

  it('sends a single email for a burst of simultaneous failures', async () => {
    mockPrisma.ingestionFailure.count.mockResolvedValueOnce(0).mockResolvedValue(1);
    await Promise.all([service.recordFailure(failure), service.recordFailure(failure), service.recordFailure(failure)]);
    expect(mockMail.send).toHaveBeenCalledTimes(2); // support + one director, once
  });

  it('tick sends a digest only for orgs whose window has elapsed', async () => {
    mockPrisma.ingestionFailure.groupBy.mockResolvedValue([{ orgId: 'org-1' }, { orgId: 'org-2' }]);
    mockPrisma.ingestionFailure.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    await service.sendDueDigests();
    expect(mockPrisma.ingestionFailure.updateMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.ingestionFailure.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orgId: 'org-1', reportedAt: null } }),
    );
  });

  it('never throws when mail or the database fails', async () => {
    mockPrisma.ingestionFailure.count.mockResolvedValue(0);
    mockMail.send.mockRejectedValue(new Error('SES down'));
    await expect(service.recordFailure(failure)).resolves.toBeUndefined();
    mockPrisma.ingestionFailure.groupBy.mockRejectedValue(new Error('db down'));
    await expect(service.sendDueDigests()).resolves.toBeUndefined();
  });
});
