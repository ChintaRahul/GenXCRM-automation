import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { TendersService } from './tenders.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';

describe('TendersService', () => {
  let service: TendersService;
  let prisma: any;
  const director: AuthUser = { id: 'u1', orgId: 'org-1', role: Role.DIRECTOR } as AuthUser;
  const future = new Date(Date.now() + 10 * 86_400_000);
  const ready = { id: 't-1', orgId: 'org-1', status: 'Preparing', emdStatus: 'Not required', docsReady: true, technicalBidReady: true, financialBidReady: true, submissionDeadline: future };

  beforeEach(async () => {
    prisma = {
      tender: { findMany: jest.fn(), findFirst: jest.fn(), count: jest.fn(), create: jest.fn(), update: jest.fn() },
      account: { findFirst: jest.fn() },
      opportunity: { findFirst: jest.fn() },
      rolePermission: { findFirst: jest.fn() },
      user: { findMany: jest.fn() },
    };
    const module = await Test.createTestingModule({ providers: [TendersService, { provide: PrismaService, useValue: prisma }] }).compile();
    service = module.get(TendersService);
  });

  it('scopes the list to the org', async () => {
    prisma.tender.count.mockResolvedValue(0);
    prisma.tender.findMany.mockResolvedValue([]);
    await service.findAll({ page: 1, limit: 20 }, director);
    expect(prisma.tender.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1', isDeleted: false }) }));
  });

  it('throws NotFound for a tender in another org', async () => {
    prisma.tender.findFirst.mockResolvedValue(null);
    await expect(service.findOne('x', director)).rejects.toThrow(NotFoundException);
  });

  it('starts at Identified with EMD Pending when an EMD amount is given', async () => {
    prisma.tender.create.mockResolvedValue({ id: 't-1' });
    await service.create({ title: 'Rail', tenderNo: 'T-1', authority: 'IR', estimatedValue: 100, submissionDeadline: future.toISOString(), emdAmount: 5000 }, director);
    expect(prisma.tender.create).toHaveBeenCalledWith({ data: expect.objectContaining({ orgId: 'org-1', status: 'Identified', emdStatus: 'Pending' }) });
  });

  it('marks EMD as not required without an amount', async () => {
    prisma.tender.create.mockResolvedValue({ id: 't-1' });
    await service.create({ title: 'Rail', tenderNo: 'T-1', authority: 'IR', estimatedValue: 100, submissionDeadline: future.toISOString() }, director);
    expect(prisma.tender.create).toHaveBeenCalledWith({ data: expect.objectContaining({ emdStatus: 'Not required' }) });
  });

  it('rejects an account from another org', async () => {
    prisma.account.findFirst.mockResolvedValue(null);
    await expect(service.create({ title: 'x', tenderNo: '1', authority: 'a', estimatedValue: 1, submissionDeadline: future.toISOString(), accountId: 'other' }, director)).rejects.toThrow(BadRequestException);
  });

  it('will not submit until the checklist is complete', async () => {
    prisma.tender.findFirst.mockResolvedValue({ ...ready, financialBidReady: false });
    await expect(service.performAction('t-1', 'Submit tender', undefined, director)).rejects.toThrow(/Financial bid/);
  });

  it('will not submit while the EMD is still pending', async () => {
    prisma.tender.findFirst.mockResolvedValue({ ...ready, emdStatus: 'Pending' });
    await expect(service.performAction('t-1', 'Submit tender', undefined, director)).rejects.toThrow(/EMD/);
  });

  it('will not submit after the deadline', async () => {
    prisma.tender.findFirst.mockResolvedValue({ ...ready, submissionDeadline: new Date(Date.now() - 1000) });
    await expect(service.performAction('t-1', 'Submit tender', undefined, director)).rejects.toThrow(/deadline/);
  });

  it('submits a ready tender', async () => {
    prisma.tender.findFirst.mockResolvedValue(ready);
    prisma.tender.update.mockResolvedValue({ id: 't-1' });
    await service.performAction('t-1', 'Submit tender', undefined, director);
    expect(prisma.tender.update).toHaveBeenCalledWith({ where: { id: 't-1' }, data: { status: 'Submitted' } });
  });

  it('needs a reason to mark a tender lost', async () => {
    prisma.tender.findFirst.mockResolvedValue({ ...ready, status: 'Submitted' });
    await expect(service.performAction('t-1', 'Mark lost', {}, director)).rejects.toThrow(/note/);
  });

  it('moves the EMD through paid then refunded, in order', async () => {
    prisma.tender.findFirst.mockResolvedValue({ ...ready, emdStatus: 'Pending' });
    prisma.tender.update.mockResolvedValue({ id: 't-1' });
    await service.performAction('t-1', 'Mark EMD paid', undefined, director);
    expect(prisma.tender.update).toHaveBeenCalledWith({ where: { id: 't-1' }, data: { emdStatus: 'Paid' } });
    await expect(service.performAction('t-1', 'Mark EMD refunded', undefined, director)).rejects.toThrow(/EMD is 'Pending'/);
  });
});
