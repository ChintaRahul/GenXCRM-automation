import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { MfgReportsService } from './mfg-reports.service';
import { isDeliveryDue, MfgReportDeliveryService } from './mfg-report-delivery.service';

describe('isDeliveryDue', () => {
  const at = (iso: string) => new Date(iso);
  it('is never due when not scheduled', () => expect(isDeliveryDue('Not scheduled', null, null, at('2026-10-05T10:00:00'))).toBe(false));
  it('waits for the send hour', () => expect(isDeliveryDue('Daily', '09:00', null, at('2026-10-05T08:00:00'))).toBe(false));
  it('is due the first time once the hour has passed', () => expect(isDeliveryDue('Daily', '09:00', null, at('2026-10-05T09:30:00'))).toBe(true));
  it('does not repeat a daily report the same day', () => expect(isDeliveryDue('Daily', '08:00', at('2026-10-05T08:05:00'), at('2026-10-05T15:00:00'))).toBe(false));
  it('repeats a weekly report after a week', () => expect(isDeliveryDue('Weekly', '08:00', at('2026-09-28T08:05:00'), at('2026-10-05T09:00:00'))).toBe(true));
  it('sends a monthly report once per calendar month', () => {
    expect(isDeliveryDue('Monthly', '08:00', at('2026-10-01T08:05:00'), at('2026-10-20T09:00:00'))).toBe(false);
    expect(isDeliveryDue('Monthly', '08:00', at('2026-09-30T08:05:00'), at('2026-10-01T09:00:00'))).toBe(true);
  });
});

describe('MfgReportDeliveryService.deliverDueReports', () => {
  let service: MfgReportDeliveryService;
  const prisma = {
    report: { findMany: jest.fn() },
    user: { findMany: jest.fn() },
    reportSchedule: { create: jest.fn() },
  };
  const reports = { buildCsv: jest.fn() };
  const mail = { sendRaw: jest.fn() };
  const report = { id: 'r-1', orgId: 'org-1', name: 'Pipeline', format: 'Excel', scheduleFrequency: 'Daily', sendAt: '08:00', recipients: 'a@x.com, outsider@y.com', schedules: [] };

  beforeEach(async () => {
    jest.clearAllMocks();
    reports.buildCsv.mockResolvedValue({ filename: 'Pipeline.csv', buffer: Buffer.from('a') });
    const module = await Test.createTestingModule({
      providers: [
        MfgReportDeliveryService,
        { provide: PrismaService, useValue: prisma },
        { provide: MfgReportsService, useValue: reports },
        { provide: MailService, useValue: mail },
      ],
    }).compile();
    service = module.get(MfgReportDeliveryService);
  });

  it('emails the CSV only to recipients who belong to the org and logs the run', async () => {
    prisma.report.findMany.mockResolvedValue([report]);
    prisma.user.findMany.mockResolvedValue([{ email: 'a@x.com' }]);
    await service.deliverDueReports(new Date('2026-10-05T09:00:00'));
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1' }) }));
    expect(mail.sendRaw).toHaveBeenCalledTimes(1);
    expect(mail.sendRaw).toHaveBeenCalledWith('a@x.com', expect.any(String), expect.any(String), [expect.objectContaining({ filename: 'Pipeline.csv' })]);
    expect(prisma.reportSchedule.create).toHaveBeenCalledWith({ data: expect.objectContaining({ status: 'Sent', recipientsSentTo: 'a@x.com' }) });
  });

  it('skips and logs when no recipient belongs to the org', async () => {
    prisma.report.findMany.mockResolvedValue([report]);
    prisma.user.findMany.mockResolvedValue([]);
    await service.deliverDueReports(new Date('2026-10-05T09:00:00'));
    expect(mail.sendRaw).not.toHaveBeenCalled();
    expect(prisma.reportSchedule.create).toHaveBeenCalledWith({ data: expect.objectContaining({ status: expect.stringContaining('Skipped') }) });
  });

  it('does not resend a report already delivered today', async () => {
    prisma.report.findMany.mockResolvedValue([{ ...report, schedules: [{ ranAt: new Date('2026-10-05T08:05:00') }] }]);
    await service.deliverDueReports(new Date('2026-10-05T12:00:00'));
    expect(mail.sendRaw).not.toHaveBeenCalled();
  });
});
