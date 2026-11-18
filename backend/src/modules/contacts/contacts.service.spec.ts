import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { ContactsService } from './contacts.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';

const mockPrisma = {
  contact: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn() },
  account: { findFirst: jest.fn() },
  opportunity: { findMany: jest.fn(), count: jest.fn() },
  rolePermission: { findFirst: jest.fn() },
  plant: { findFirst: jest.fn() },
};

const repUser: AuthUser = { id: 'rep-1', name: 'Rep', email: 'rep@test.com', role: Role.SALES_REP, teamId: 'team-1', orgId: 'org-1' };
const directorUser: AuthUser = { id: 'dir-1', name: 'Dir', email: 'dir@test.com', role: Role.DIRECTOR, teamId: null, orgId: 'org-1' };

describe('ContactsService', () => {
  let service: ContactsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [ContactsService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get(ContactsService);
  });

  it('scopes findAll to orgId', async () => {
    mockPrisma.contact.count.mockResolvedValue(0);
    mockPrisma.contact.findMany.mockResolvedValue([]);
    await service.findAll({ page: 1, limit: 20 }, directorUser);
    expect(mockPrisma.contact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1', isDeleted: false }) }),
    );
  });

  it('filters findAll by accountId when passed', async () => {
    mockPrisma.contact.count.mockResolvedValue(0);
    mockPrisma.contact.findMany.mockResolvedValue([]);
    await service.findAll({ page: 1, limit: 20, accountId: 'A-1' }, directorUser);
    expect(mockPrisma.contact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ accountId: 'A-1' }) }),
    );
  });

  it('findOne throws NotFoundException outside the org', async () => {
    mockPrisma.contact.findFirst.mockResolvedValue(null);
    await expect(service.findOne('C-1', directorUser)).rejects.toThrow(NotFoundException);
  });

  it('create scopes the new record to the caller org', async () => {
    mockPrisma.account.findFirst.mockResolvedValue({ id: 'A-1', orgId: 'org-1' });
    mockPrisma.contact.create.mockResolvedValue({ id: 'C-1' });
    await service.create(
      { accountId: 'A-1', name: 'Jane', phone: '9999999999', role: 'Procurement' } as never,
      directorUser,
    );
    expect(mockPrisma.contact.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ orgId: 'org-1', status: 'Active' }),
    });
  });

  it('create rejects an accountId belonging to a different org', async () => {
    mockPrisma.account.findFirst.mockResolvedValue(null);
    await expect(
      service.create(
        { accountId: 'A-evil', name: 'Jane', phone: '9999999999', role: 'Procurement' } as never,
        directorUser,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('archive sets isDeleted true', async () => {
    mockPrisma.contact.findFirst.mockResolvedValue({ id: 'C-1', orgId: 'org-1' });
    mockPrisma.contact.update.mockResolvedValue({});
    await service.archive('C-1', directorUser);
    expect(mockPrisma.contact.update).toHaveBeenCalledWith({ where: { id: 'C-1' }, data: { isDeleted: true } });
  });

  it('create throws ForbiddenException when caller has no orgId', async () => {
    mockPrisma.account.findFirst.mockResolvedValue({ id: 'A-1', orgId: undefined });
    const noOrgUser = { ...directorUser, orgId: null } as unknown as AuthUser;
    await expect(
      service.create(
        { accountId: 'A-1', name: 'Jane', phone: '9999999999', role: 'Procurement' } as never,
        noOrgUser,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('SALES_REP is not restricted to their own records (Contacts have no ownerId)', async () => {
    mockPrisma.contact.count.mockResolvedValue(0);
    mockPrisma.contact.findMany.mockResolvedValue([]);
    await service.findAll({ page: 1, limit: 20 }, repUser);
    const where = mockPrisma.contact.findMany.mock.calls[0][0].where;
    expect(where.orgId).toBe('org-1');
  });

  it('create blocks a second contact with the same phone or email on the account', async () => {
    mockPrisma.account.findFirst.mockResolvedValue({ id: 'A-1' });
    mockPrisma.contact.findFirst.mockResolvedValue({ id: 'abcdef12-0000', name: 'Ramesh' });
    await expect(
      service.create({ accountId: 'A-1', name: 'X', phone: '9812345678', email: 'R@X.in', role: 'User' } as never, directorUser),
    ).rejects.toThrow(ConflictException);
    expect(mockPrisma.contact.create).not.toHaveBeenCalled();
    expect(mockPrisma.contact.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          orgId: 'org-1',
          accountId: 'A-1',
          OR: [{ phone: '9812345678' }, { email: { equals: 'r@x.in', mode: 'insensitive' } }],
        }),
      }),
    );
  });

  it('search also matches email', async () => {
    mockPrisma.contact.count.mockResolvedValue(0);
    mockPrisma.contact.findMany.mockResolvedValue([]);
    await service.findAll({ page: 1, limit: 20, search: 'a@b.in' }, directorUser);
    const { where } = mockPrisma.contact.findMany.mock.calls[0][0];
    expect(where.OR).toEqual(expect.arrayContaining([{ email: { contains: 'a@b.in', mode: 'insensitive' } }]));
  });

  it('Mark inactive and Reactivate move the status, and reject the wrong starting status', async () => {
    mockPrisma.contact.findFirst.mockResolvedValue({ id: 'C-1', status: 'Active' });
    mockPrisma.contact.update.mockResolvedValue({ id: 'C-1', status: 'Inactive' });
    await service.performAction('C-1', 'Mark inactive', directorUser);
    expect(mockPrisma.contact.update).toHaveBeenCalledWith({ where: { id: 'C-1' }, data: { status: 'Inactive' } });
    await expect(service.performAction('C-1', 'Reactivate', directorUser)).rejects.toThrow(BadRequestException);
    await expect(service.performAction('C-1', 'Nope', directorUser)).rejects.toThrow(BadRequestException);
  });

  it('findOpportunities lists only the opportunities linked to this contact inside the org and the caller scope', async () => {
    mockPrisma.contact.findFirst.mockResolvedValue({ id: 'C-1' });
    mockPrisma.opportunity.count.mockResolvedValue(0);
    mockPrisma.opportunity.findMany.mockResolvedValue([]);
    await service.findOpportunities('C-1', { page: 1, limit: 20 }, repUser);
    expect(mockPrisma.opportunity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1', contactId: 'C-1', ownerId: 'rep-1', isDeleted: false }) }),
    );
  });

  it('create rejects a plant that is not one of the account plants', async () => {
    mockPrisma.account.findFirst.mockResolvedValue({ id: 'A-1' });
    mockPrisma.plant.findFirst.mockResolvedValue(null);
    await expect(
      service.create({ accountId: 'A-1', name: 'X', phone: '9000000001', role: 'User', plant: 'Nowhere' } as never, directorUser),
    ).rejects.toThrow(BadRequestException);
    expect(mockPrisma.plant.findFirst).toHaveBeenCalledWith({ where: { accountId: 'A-1', name: 'Nowhere' } });
    expect(mockPrisma.contact.create).not.toHaveBeenCalled();
  });

  it('create accepts one of the account plants', async () => {
    mockPrisma.account.findFirst.mockResolvedValue({ id: 'A-1' });
    mockPrisma.plant.findFirst.mockResolvedValue({ id: 'p-1' });
    mockPrisma.contact.findFirst.mockResolvedValue(null);
    mockPrisma.contact.create.mockResolvedValue({ id: 'C-1' });
    await service.create({ accountId: 'A-1', name: 'X', phone: '9000000001', role: 'User', plant: 'Plant 2' } as never, directorUser);
    expect(mockPrisma.contact.create).toHaveBeenCalled();
  });

  it('a Sales Rep only lists contacts of accounts they own; a director sees the whole org', async () => {
    mockPrisma.contact.count.mockResolvedValue(0);
    mockPrisma.contact.findMany.mockResolvedValue([]);
    await service.findAll({ page: 1, limit: 20 }, repUser);
    expect(mockPrisma.contact.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1', account: { ownerId: 'rep-1' } }) }),
    );
    await service.findAll({ page: 1, limit: 20 }, directorUser);
    expect(mockPrisma.contact.findMany.mock.calls[1][0].where.account).toBeUndefined();
  });

  it('a Sales Rep cannot open a contact of an account they do not own', async () => {
    mockPrisma.contact.findFirst.mockResolvedValue(null);
    await expect(service.findOne('C-9', repUser)).rejects.toThrow(NotFoundException);
    expect(mockPrisma.contact.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: 'C-9', orgId: 'org-1', account: { ownerId: 'rep-1' } }),
    });
  });
});
