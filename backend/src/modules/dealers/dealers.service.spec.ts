import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { DealersService } from './dealers.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';

describe('DealersService', () => {
  let service: DealersService;
  let prisma: any;
  const director: AuthUser = { id: 'u1', orgId: 'org-1', role: Role.DIRECTOR } as AuthUser;
  const dealer = { id: 'd-1', orgId: 'org-1', name: 'Shree Traders', status: 'Active' };

  beforeEach(async () => {
    prisma = {
      dealer: { findMany: jest.fn(), findFirst: jest.fn(), count: jest.fn(), create: jest.fn(), update: jest.fn() },
      dealerDeal: { groupBy: jest.fn().mockResolvedValue([]), findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), updateMany: jest.fn(), deleteMany: jest.fn() },
      rolePermission: { findFirst: jest.fn() },
      user: { findMany: jest.fn() },
    };
    const module = await Test.createTestingModule({ providers: [DealersService, { provide: PrismaService, useValue: prisma }] }).compile();
    service = module.get(DealersService);
  });

  it('scopes the list to the org and hides archived dealers', async () => {
    prisma.dealer.count.mockResolvedValue(0);
    prisma.dealer.findMany.mockResolvedValue([]);
    await service.findAll({ page: 1, limit: 20 }, director);
    expect(prisma.dealer.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1', isDeleted: false }) }));
  });

  it('adds registered, won and won-value performance to each dealer', async () => {
    prisma.dealer.count.mockResolvedValue(1);
    prisma.dealer.findMany.mockResolvedValue([dealer]);
    prisma.dealerDeal.groupBy.mockResolvedValue([
      { dealerId: 'd-1', status: 'Registered', _count: 2, _sum: { value: 500 } },
      { dealerId: 'd-1', status: 'Won', _count: 1, _sum: { value: 900 } },
    ]);
    const { data } = await service.findAll({ page: 1, limit: 20 }, director);
    expect(data[0]).toMatchObject({ dealsRegistered: 3, dealsWon: 1, wonValue: 900 });
  });

  it('throws NotFound for a dealer in another org', async () => {
    prisma.dealer.findFirst.mockResolvedValue(null);
    await expect(service.findOne('x', director)).rejects.toThrow(NotFoundException);
  });

  it('rejects a duplicate dealer name', async () => {
    prisma.dealer.findFirst.mockResolvedValue({ name: 'Shree Traders' });
    await expect(service.create({ name: 'shree traders', territory: 'West' }, director)).rejects.toThrow(ConflictException);
  });

  it('refuses to register a customer another dealer already protects', async () => {
    prisma.dealer.findFirst.mockResolvedValue(dealer);
    prisma.dealerDeal.findFirst.mockResolvedValue({ expiresOn: new Date('2027-01-01'), dealer: { name: 'Other Dealer' } });
    await expect(service.registerDeal('d-1', { customer: 'Acme', product: 'Weighbridge', value: 100 }, director)).rejects.toThrow(/Other Dealer/);
    expect(prisma.dealerDeal.create).not.toHaveBeenCalled();
  });

  it('registers a deal with a 90-day protection window', async () => {
    prisma.dealer.findFirst.mockResolvedValue(dealer);
    prisma.dealerDeal.findFirst.mockResolvedValue(null);
    await service.registerDeal('d-1', { customer: 'Acme', product: 'Weighbridge', value: 100 }, director);
    const { data } = prisma.dealerDeal.create.mock.calls[0][0];
    expect(data).toMatchObject({ orgId: 'org-1', dealerId: 'd-1', status: 'Registered' });
    expect(Math.round((data.expiresOn.getTime() - Date.now()) / 86_400_000)).toBe(90);
  });

  it('blocks deal registration for an inactive dealer', async () => {
    prisma.dealer.findFirst.mockResolvedValue({ ...dealer, status: 'Inactive' });
    await expect(service.registerDeal('d-1', { customer: 'Acme', product: 'X', value: 1 }, director)).rejects.toThrow(BadRequestException);
  });

  it('marks the registered deal for a customer as won', async () => {
    prisma.dealer.findFirst.mockResolvedValue(dealer);
    prisma.dealerDeal.updateMany.mockResolvedValue({ count: 1 });
    await service.performAction('d-1', 'Mark deal won', { customer: 'Acme' }, director);
    expect(prisma.dealerDeal.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1', status: 'Registered' }), data: { status: 'Won' } }));
  });

  it('errors when there is no registered deal for that customer', async () => {
    prisma.dealer.findFirst.mockResolvedValue(dealer);
    prisma.dealerDeal.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.performAction('d-1', 'Mark deal lost', { customer: 'Nobody' }, director)).rejects.toThrow(/No registered deal/);
  });

  it('deactivates only an active dealer', async () => {
    prisma.dealer.findFirst.mockResolvedValue({ ...dealer, status: 'Inactive' });
    await expect(service.performAction('d-1', 'Deactivate', undefined, director)).rejects.toThrow(BadRequestException);
  });
});
