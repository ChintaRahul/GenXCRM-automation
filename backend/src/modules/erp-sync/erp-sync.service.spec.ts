import { createHmac } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { ErpSyncService } from './erp-sync.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';

describe('ErpSyncService', () => {
  let service: ErpSyncService;
  let prisma: any;
  const director: AuthUser = { id: 'u1', orgId: 'org-1', role: Role.DIRECTOR } as AuthUser;
  const connection = { id: 'c-1', orgId: 'org-1', name: 'Tally', endpointUrl: 'https://erp.example/hook', secret: 'shh', entities: 'customers', isActive: true, lastSyncAt: null };
  const fetchMock = jest.fn();

  beforeEach(async () => {
    jest.clearAllMocks();
    (global as any).fetch = fetchMock;
    prisma = {
      erpConnection: { findMany: jest.fn(), findFirst: jest.fn(), count: jest.fn(), create: jest.fn(), update: jest.fn() },
      erpSyncLog: { create: jest.fn(), findMany: jest.fn() },
      account: { findMany: jest.fn().mockResolvedValue([{ id: 'a-1', name: 'Acme' }]) },
      product: { findMany: jest.fn().mockResolvedValue([]) },
      salesOrder: { findMany: jest.fn().mockResolvedValue([]) },
      dispatch: { findMany: jest.fn().mockResolvedValue([]) },
      receipt: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const module = await Test.createTestingModule({ providers: [ErpSyncService, { provide: PrismaService, useValue: prisma }] }).compile();
    service = module.get(ErpSyncService);
  });

  it('never returns the signing secret to the browser', async () => {
    prisma.erpConnection.findFirst.mockResolvedValue(connection);
    expect((await service.findOne('c-1', director)).secret).not.toBe('shh');
  });

  it('scopes lookups to the org', async () => {
    prisma.erpConnection.findFirst.mockResolvedValue(null);
    await expect(service.findOne('c-1', director)).rejects.toThrow(NotFoundException);
    expect(prisma.erpConnection.findFirst).toHaveBeenCalledWith({ where: expect.objectContaining({ orgId: 'org-1' }) });
  });

  it('rejects unknown entities', async () => {
    await expect(service.create({ name: 'x', endpointUrl: 'https://e.x', secret: 's', entities: 'customers,widgets' }, director)).rejects.toThrow(BadRequestException);
  });

  it('keeps the stored secret when the masked value comes back unchanged', async () => {
    prisma.erpConnection.findFirst.mockResolvedValue(connection);
    prisma.erpConnection.update.mockResolvedValue(connection);
    await service.update('c-1', { name: 'Renamed', secret: '••••••••' }, director);
    expect(prisma.erpConnection.update).toHaveBeenCalledWith({ where: { id: 'c-1' }, data: { name: 'Renamed' } });
  });

  it('pushes changed records signed with HMAC-SHA256, logs it and moves the watermark', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    await service.sync(connection);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://erp.example/hook');
    expect(init.headers['X-GenXCRM-Signature']).toBe(createHmac('sha256', 'shh').update(init.body).digest('hex'));
    expect(JSON.parse(init.body)).toMatchObject({ entity: 'customers', records: [{ id: 'a-1' }] });
    expect(prisma.account.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1' }) }));
    expect(prisma.erpSyncLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ entity: 'customers', status: 'Sent', records: 1 }) });
    expect(prisma.erpConnection.update).toHaveBeenCalledWith({ where: { id: 'c-1' }, data: expect.objectContaining({ lastStatus: 'OK', lastSyncAt: expect.any(Date) }) });
  });

  it('logs a failed push and keeps the watermark so it is retried', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    await service.sync(connection);
    expect(prisma.erpSyncLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ status: 'Failed', detail: expect.stringContaining('500') }) });
    const { data } = prisma.erpConnection.update.mock.calls[0][0];
    expect(data.lastStatus).toBe('Failed');
    expect(data).not.toHaveProperty('lastSyncAt');
  });

  it('only sends records changed since the last sync', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    const since = new Date('2026-10-01');
    await service.sync({ ...connection, lastSyncAt: since });
    expect(prisma.account.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ updatedAt: { gt: since } }) }));
  });

  it('skips the request when nothing changed', async () => {
    prisma.account.findMany.mockResolvedValue([]);
    await service.sync(connection);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
