import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AccountsService } from './accounts.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';

const mockPrisma = {
  account: { groupBy: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn() },
  plant: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), delete: jest.fn() },
  user: { findFirst: jest.fn() },
  rolePermission: { findFirst: jest.fn() },
};

const repUser: AuthUser = { id: 'rep-1', name: 'Rep', email: 'rep@test.com', role: Role.SALES_REP, teamId: 'team-1', orgId: 'org-1' };
const managerUser: AuthUser = { id: 'mgr-1', name: 'Mgr', email: 'mgr@test.com', role: Role.MANAGER, teamId: 'team-1', orgId: 'org-1' };
const directorUser: AuthUser = { id: 'dir-1', name: 'Dir', email: 'dir@test.com', role: Role.DIRECTOR, teamId: null, orgId: 'org-1' };

describe('AccountsService', () => {
  let service: AccountsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.account.findMany.mockResolvedValue([]);
    const module = await Test.createTestingModule({
      providers: [AccountsService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get(AccountsService);
  });

  it('scopes findAll to ownerId for SALES_REP', async () => {
    mockPrisma.account.count.mockResolvedValue(0);
    mockPrisma.account.findMany.mockResolvedValue([]);
    await service.findAll({ page: 1, limit: 20 }, repUser);
    expect(mockPrisma.account.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1', ownerId: 'rep-1' }) }),
    );
  });

  it('follows the role matrix: Operations (Sales Rep level) with ALL access sees every account in the org', async () => {
    mockPrisma.rolePermission.findFirst.mockResolvedValue({ recordAccess: 'ALL' });
    mockPrisma.account.count.mockResolvedValue(0);
    await service.findAll({ page: 1, limit: 20 }, { ...repUser, mfgRole: 'OPERATIONS' } as AuthUser);
    const where = mockPrisma.account.findMany.mock.calls[0][0].where;
    expect(where.orgId).toBe('org-1');
    expect(where.ownerId).toBeUndefined();
  });

  it('search matches name, short name, GSTIN and city within the org', async () => {
    mockPrisma.account.count.mockResolvedValue(0);
    mockPrisma.account.findMany.mockResolvedValue([]);
    await service.findAll({ page: 1, limit: 20, search: '27AAB' }, directorUser);
    const where = mockPrisma.account.findMany.mock.calls[0][0].where;
    expect(where.orgId).toBe('org-1');
    expect(where.OR).toEqual(
      expect.arrayContaining([
        { gstin: { contains: '27AAB', mode: 'insensitive' } },
        { city: { contains: '27AAB', mode: 'insensitive' } },
      ]),
    );
  });

  it('does not scope findAll to ownerId for MANAGER', async () => {
    mockPrisma.account.count.mockResolvedValue(0);
    mockPrisma.account.findMany.mockResolvedValue([]);
    await service.findAll({ page: 1, limit: 20 }, managerUser);
    const where = mockPrisma.account.findMany.mock.calls[0][0].where;
    expect(where.ownerId).toBeUndefined();
    expect(where.orgId).toBe('org-1');
  });

  it('does not scope findAll to ownerId for DIRECTOR', async () => {
    mockPrisma.account.count.mockResolvedValue(0);
    mockPrisma.account.findMany.mockResolvedValue([]);
    await service.findAll({ page: 1, limit: 20 }, directorUser);
    const where = mockPrisma.account.findMany.mock.calls[0][0].where;
    expect(where.ownerId).toBeUndefined();
  });

  it('SALES_REP passing ?owner=<other-rep> still only sees their own records', async () => {
    mockPrisma.account.count.mockResolvedValue(0);
    mockPrisma.account.findMany.mockResolvedValue([]);
    await service.findAll({ page: 1, limit: 20, ownerId: ['other-rep-id'] }, repUser);
    const where = mockPrisma.account.findMany.mock.calls[0][0].where;
    expect(where.ownerId).toBe('rep-1');
  });

  it('keeps orgId in the where clause when multi-select filters are applied', async () => {
    mockPrisma.account.count.mockResolvedValue(0);
    mockPrisma.account.findMany.mockResolvedValue([]);
    await service.findAll(
      { page: 1, limit: 20, status: ['Active', 'Dormant'], facets: JSON.stringify({ industry: ['Cement'] }) },
      managerUser,
    );
    expect(mockPrisma.account.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          orgId: 'org-1',
          AND: [{ status: { in: ['Active', 'Dormant'] } }, { industry: { in: ['Cement'] } }],
        }),
      }),
    );
  });

  it('getFacets counts over an orgId-scoped, role-scoped base where', async () => {
    mockPrisma.account.count.mockResolvedValue(3);
    mockPrisma.account.groupBy.mockResolvedValue([]);
    await service.getFacets({ page: 1, limit: 20 }, repUser);
    expect(mockPrisma.account.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1', ownerId: 'rep-1', isDeleted: false }) }),
    );
  });

  it('create defaults ownerId to the caller for a SALES_REP when omitted', async () => {
    mockPrisma.account.create.mockResolvedValue({ id: 'A-1' });
    await service.create(
      { name: 'Acme', short: 'ACM', type: 'Prospect', industry: 'Cement', city: 'X', state: 'Y', territory: 'North' } as never,
      repUser,
    );
    expect(mockPrisma.account.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ ownerId: 'rep-1' }),
    });
  });

  it('create throws ForbiddenException when caller has no orgId', async () => {
    const noOrgUser = { ...directorUser, orgId: null } as unknown as AuthUser;
    await expect(
      service.create(
        { name: 'Acme', short: 'ACM', type: 'Prospect', industry: 'Cement', city: 'X', state: 'Y', territory: 'North' } as never,
        noOrgUser,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('performAction "Mark dormant" transitions Active -> Dormant', async () => {
    mockPrisma.account.findFirst.mockResolvedValue({ id: 'A-1', orgId: 'org-1', status: 'Active' });
    mockPrisma.account.update.mockResolvedValue({ id: 'A-1', status: 'Dormant' });
    await service.performAction('A-1', 'Mark dormant', {}, directorUser);
    expect(mockPrisma.account.update).toHaveBeenCalledWith({ where: { id: 'A-1' }, data: { status: 'Dormant' } });
  });

  it('performAction "Mark dormant" rejects an already-Dormant account', async () => {
    mockPrisma.account.findFirst.mockResolvedValue({ id: 'A-1', orgId: 'org-1', status: 'Dormant' });
    await expect(service.performAction('A-1', 'Mark dormant', {}, directorUser)).rejects.toThrow(BadRequestException);
  });

  it('performAction "Reassign owner" sets the new owner after checking the user is in the org', async () => {
    mockPrisma.account.findFirst.mockResolvedValue({ id: 'A-1', status: 'Active' });
    mockPrisma.user.findFirst.mockResolvedValue({ id: 'rep-2' });
    mockPrisma.account.update.mockResolvedValue({ id: 'A-1', ownerId: 'rep-2' });
    await service.performAction('A-1', 'Reassign owner', { owner: 'rep-2' }, directorUser);
    expect(mockPrisma.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'rep-2', orgId: 'org-1' } }));
    expect(mockPrisma.account.update).toHaveBeenCalledWith({ where: { id: 'A-1' }, data: { ownerId: 'rep-2' } });
  });

  it('"Reassign owner" rejects a missing owner and a user from another org', async () => {
    mockPrisma.account.findFirst.mockResolvedValue({ id: 'A-1', status: 'Active' });
    await expect(service.performAction('A-1', 'Reassign owner', {}, directorUser)).rejects.toThrow(BadRequestException);
    mockPrisma.user.findFirst.mockResolvedValue(null);
    await expect(service.performAction('A-1', 'Reassign owner', { owner: 'x' }, directorUser)).rejects.toThrow(BadRequestException);
    expect(mockPrisma.account.update).not.toHaveBeenCalled();
  });

  it('create blocks a second account with the same GSTIN or the same normalised name', async () => {
    mockPrisma.account.findMany.mockResolvedValue([{ id: 'aaaaaa11-0000', name: 'Shree Steel Pvt. Ltd.', gstin: '27AABCS1234A1Z5' }]);
    await expect(service.create({ name: 'Other Co', gstin: '27aabcs1234a1z5' } as never, directorUser)).rejects.toThrow(ConflictException);
    await expect(service.create({ name: 'Shree Steel Private Limited' } as never, directorUser)).rejects.toThrow(ConflictException);
    expect(mockPrisma.account.create).not.toHaveBeenCalled();
    expect(mockPrisma.account.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1' }) }));
  });


  it('getPlantsTable returns columns and rows from Plant, with territory from the account', async () => {
    mockPrisma.account.findFirst.mockResolvedValue({ id: 'A-1', orgId: 'org-1', territory: 'South' });
    mockPrisma.plant.findMany.mockResolvedValue([{ id: 'P-1', name: 'Main plant', type: 'Manufacturing', city: 'Bellary' }]);
    const table = await service.getPlantsTable('A-1', directorUser);
    expect(table.columns).toEqual([
      { key: 'name', label: 'Plant', type: 'text' },
      { key: 'type', label: 'Type', type: 'text' },
      { key: 'city', label: 'City', type: 'text' },
      { key: 'address', label: 'Address', type: 'text' },
      { key: 'territory', label: 'Territory', type: 'text' },
    ]);
    expect(table.rows).toEqual([{ id: 'P-1', name: 'Main plant', type: 'Manufacturing', city: 'Bellary', address: undefined, territory: 'South' }]);
  });

  it('findOne throws NotFoundException for a record outside the org', async () => {
    mockPrisma.account.findFirst.mockResolvedValue(null);
    await expect(service.findOne('A-1', directorUser)).rejects.toThrow(NotFoundException);
  });

  it('addPlant creates a plant on an account in the caller org', async () => {
    mockPrisma.account.findFirst.mockResolvedValue({ id: 'A-1', orgId: 'org-1' });
    mockPrisma.plant.findFirst.mockResolvedValue(null);
    await service.addPlant('A-1', { name: ' Plant 2 ', type: 'Warehouse', city: 'Nashik ' }, directorUser);
    expect(mockPrisma.account.findFirst).toHaveBeenCalledWith({ where: expect.objectContaining({ id: 'A-1', orgId: 'org-1' }) });
    expect(mockPrisma.plant.create).toHaveBeenCalledWith({ data: { accountId: 'A-1', name: 'Plant 2', type: 'Warehouse', city: 'Nashik' } });
  });

  it('addPlant rejects a second plant with the same name', async () => {
    mockPrisma.account.findFirst.mockResolvedValue({ id: 'A-1', orgId: 'org-1' });
    mockPrisma.plant.findFirst.mockResolvedValue({ id: 'p-1', name: 'Plant 1' });
    await expect(service.addPlant('A-1', { name: 'plant 1', type: 'Other', city: 'X' }, directorUser)).rejects.toThrow(ConflictException);
    expect(mockPrisma.plant.create).not.toHaveBeenCalled();
  });

  it('removePlant only deletes a plant that belongs to the account', async () => {
    mockPrisma.account.findFirst.mockResolvedValue({ id: 'A-1', orgId: 'org-1' });
    mockPrisma.plant.findFirst.mockResolvedValue(null);
    await expect(service.removePlant('A-1', 'p-9', directorUser)).rejects.toThrow(NotFoundException);
    mockPrisma.plant.findFirst.mockResolvedValue({ id: 'p-1' });
    await service.removePlant('A-1', 'p-1', directorUser);
    expect(mockPrisma.plant.delete).toHaveBeenCalledWith({ where: { id: 'p-1' } });
  });

  it('plants table rows carry the plant id so a row can be removed', async () => {
    mockPrisma.account.findFirst.mockResolvedValue({ id: 'A-1', territory: 'West' });
    mockPrisma.plant.findMany.mockResolvedValue([{ id: 'p-1', name: 'Plant 1', type: 'Manufacturing', city: 'Pune' }]);
    const table = await service.getPlantsTable('A-1', directorUser);
    expect(table.rows[0]).toMatchObject({ id: 'p-1', name: 'Plant 1' });
  });
});
