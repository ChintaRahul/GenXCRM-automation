import { BadRequestException } from '@nestjs/common';
import { AccountsAdapter } from './accounts.adapter';
import type { AuthUser } from '../../common/types/auth-user.type';
import { Role } from '@prisma/client';

const mockRegistry = { register: jest.fn() } as never;
const mockAccounts = { create: jest.fn(), update: jest.fn() };
const mockContacts = { findAll: jest.fn() };
const mockOpportunities = { findAll: jest.fn() };
const mockActivities = { findAll: jest.fn() };
const mockQuotations = { findAll: jest.fn() };
const mockSalesOrders = { findAll: jest.fn() };
const mockInstalledAssets = { findAll: jest.fn() };
const mockServiceTickets = { findAll: jest.fn() };
const mockPaymentMilestones = { findAll: jest.fn() };

const directorUser: AuthUser = { id: 'dir-1', name: 'Dir', email: 'dir@test.com', role: Role.DIRECTOR, teamId: null, orgId: 'org-1' };

const validBody = {
  name: 'Acme',
  short: 'ACM',
  type: 'Prospect',
  industry: 'Cement',
  city: 'Bellary',
  state: 'Karnataka',
  territory: 'South',
};

describe('AccountsAdapter', () => {
  let adapter: AccountsAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    adapter = new AccountsAdapter(
      mockAccounts as never,
      mockContacts as never,
      mockOpportunities as never,
      mockActivities as never,
      mockQuotations as never,
      mockSalesOrders as never,
      mockInstalledAssets as never,
      mockServiceTickets as never,
      mockPaymentMilestones as never,
      mockRegistry,
    );
  });

  it('create rejects a body with a disallowed field (e.g. orgId) with BadRequestException', async () => {
    await expect(adapter.create({ ...validBody, orgId: 'evil-org' }, directorUser)).rejects.toThrow(BadRequestException);
    expect(mockAccounts.create).not.toHaveBeenCalled();
  });

  it('create passes a valid body through to the service', async () => {
    mockAccounts.create.mockResolvedValue({ id: 'A-1' });
    await adapter.create(validBody, directorUser);
    expect(mockAccounts.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Acme' }), directorUser);
  });

  describe('getRelated', () => {
    const query = { page: 1, limit: 20 };

    it.each([
      ['quotes', mockQuotations],
      ['orders', mockSalesOrders],
      ['assets', mockInstalledAssets],
      ['service', mockServiceTickets],
      ['payments', mockPaymentMilestones],
    ])('delegates the \'%s\' tab to its own module, scoped to this account', async (tabKey, mockService) => {
      mockService.findAll.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20, pages: 0 });
      await adapter.getRelated('A-1', tabKey, query, directorUser);
      expect(mockService.findAll).toHaveBeenCalledWith({ ...query, accountId: 'A-1' }, directorUser);
    });
  });
});
