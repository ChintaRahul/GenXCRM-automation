import { Test } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { ColumnPrefsService } from './column-prefs.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';

const caller: AuthUser = { id: 'u1', name: 'U', email: 'u@t.com', role: Role.MANAGER, teamId: null, orgId: 'org-1' };
const mockPrisma = { moduleColumnPref: { findFirst: jest.fn(), upsert: jest.fn() } };

describe('ColumnPrefsService', () => {
  let service: ColumnPrefsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [ColumnPrefsService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get(ColumnPrefsService);
  });

  it('reads only the callers own saved columns within their org', async () => {
    mockPrisma.moduleColumnPref.findFirst.mockResolvedValue({ keys: ['name', 'owner'] });
    expect(await service.get('accounts', caller)).toEqual(['name', 'owner']);
    expect(mockPrisma.moduleColumnPref.findFirst).toHaveBeenCalledWith({ where: { orgId: 'org-1', userId: 'u1', moduleKey: 'accounts' } });
  });

  it('returns null when nothing is saved yet', async () => {
    mockPrisma.moduleColumnPref.findFirst.mockResolvedValue(null);
    expect(await service.get('accounts', caller)).toBeNull();
  });

  it('upserts on org, user and module', async () => {
    await service.save('accounts', ['name'], caller);
    expect(mockPrisma.moduleColumnPref.upsert).toHaveBeenCalledWith({
      where: { orgId_userId_moduleKey: { orgId: 'org-1', userId: 'u1', moduleKey: 'accounts' } },
      create: { orgId: 'org-1', userId: 'u1', moduleKey: 'accounts', keys: ['name'] },
      update: { keys: ['name'] },
    });
  });

  it('requires an organization', async () => {
    await expect(service.get('accounts', { ...caller, orgId: null })).rejects.toThrow(ForbiddenException);
  });
});
