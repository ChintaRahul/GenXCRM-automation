import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { SavedViewsService } from './saved-views.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';

const caller: AuthUser = { id: 'u1', name: 'U', email: 'u@t.com', role: Role.MANAGER, teamId: null, orgId: 'org-1' };
const mockPrisma = {
  savedView: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), deleteMany: jest.fn() },
};

describe('SavedViewsService', () => {
  let service: SavedViewsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [SavedViewsService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get(SavedViewsService);
  });

  it("lists only the caller's own views within their org and module", async () => {
    mockPrisma.savedView.findMany.mockResolvedValue([{ id: 'v1', name: 'Big', filtersJson: { slaRisk: true } }]);
    const result = await service.list('opps', caller);
    expect(mockPrisma.savedView.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orgId: 'org-1', userId: 'u1', moduleKey: 'opps' } }),
    );
    expect(result).toEqual([{ id: 'v1', name: 'Big', filters: { slaRisk: true } }]);
  });

  it('creates a view scoped to org + user', async () => {
    mockPrisma.savedView.findFirst.mockResolvedValue(null);
    mockPrisma.savedView.create.mockResolvedValue({ id: 'v1', name: 'Big', filtersJson: { a: 1 } });
    await service.create('opps', { name: 'Big', filters: { a: 1 } }, caller);
    expect(mockPrisma.savedView.create).toHaveBeenCalledWith({
      data: { orgId: 'org-1', userId: 'u1', moduleKey: 'opps', name: 'Big', filtersJson: { a: 1 } },
    });
  });

  it('replaces the filters when the name already exists instead of duplicating', async () => {
    mockPrisma.savedView.findFirst.mockResolvedValue({ id: 'v1' });
    mockPrisma.savedView.update.mockResolvedValue({ id: 'v1', name: 'Big', filtersJson: { a: 2 } });
    await service.create('opps', { name: 'Big', filters: { a: 2 } }, caller);
    expect(mockPrisma.savedView.update).toHaveBeenCalledWith({ where: { id: 'v1' }, data: { filtersJson: { a: 2 } } });
    expect(mockPrisma.savedView.create).not.toHaveBeenCalled();
  });

  it("deletes only the caller's own view and 404s when nothing matched", async () => {
    mockPrisma.savedView.deleteMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    await service.remove('opps', 'v1', caller);
    expect(mockPrisma.savedView.deleteMany).toHaveBeenCalledWith({
      where: { id: 'v1', orgId: 'org-1', userId: 'u1', moduleKey: 'opps' },
    });
    await expect(service.remove('opps', 'other', caller)).rejects.toThrow(NotFoundException);
  });
});
