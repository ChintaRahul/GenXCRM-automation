import { BadRequestException } from '@nestjs/common';
import { OpportunitiesAdapter } from './opportunities.adapter';
import type { AuthUser } from '../../common/types/auth-user.type';
import { Role } from '@prisma/client';

const mockRegistry = { register: jest.fn() } as never;
const mockOpportunities = { create: jest.fn(), update: jest.fn(), findOne: jest.fn() };
const mockActivities = { findAll: jest.fn() };
const mockContacts = { findAll: jest.fn() };
const mockRfqs = { findAll: jest.fn() };
const mockSiteVisits = { findAll: jest.fn() };
const mockEvaluations = { findAll: jest.fn() };
const mockCostingSheets = { findAll: jest.fn() };
const mockQuotations = { findAll: jest.fn() };
const mockPurchaseOrders = { findAll: jest.fn() };

const directorUser: AuthUser = { id: 'dir-1', name: 'Dir', email: 'dir@test.com', role: Role.DIRECTOR, teamId: null, orgId: 'org-1' };

const validBody = {
  title: 'New weighbridge',
  accountId: 'A-1',
  product: 'Weighbridge',
  value: 100000,
  stage: 'Qualified',
  closeDate: '2026-10-01',
  nextAction: 'Call back',
  nextActionDate: '2026-10-05',
};

describe('OpportunitiesAdapter', () => {
  let adapter: OpportunitiesAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    adapter = new OpportunitiesAdapter(
      mockOpportunities as never,
      mockActivities as never,
      mockContacts as never,
      mockRfqs as never,
      mockSiteVisits as never,
      mockEvaluations as never,
      mockCostingSheets as never,
      mockQuotations as never,
      mockPurchaseOrders as never,
      mockRegistry,
    );
  });

  it('create rejects a body with a disallowed field (e.g. orgId) with BadRequestException', async () => {
    await expect(adapter.create({ ...validBody, orgId: 'evil-org' }, directorUser)).rejects.toThrow(BadRequestException);
    expect(mockOpportunities.create).not.toHaveBeenCalled();
  });

  it('update passes a stage field through to the service (OpportunitiesService.update handles stage-history/active-state rules)', async () => {
    mockOpportunities.update.mockResolvedValue({ id: 'OP-1', stage: 'Negotiation' });
    await adapter.update('OP-1', { stage: 'Negotiation', nextAction: 'Call', nextActionDate: '2026-10-05' }, directorUser);
    expect(mockOpportunities.update).toHaveBeenCalledWith(
      'OP-1',
      expect.objectContaining({ stage: 'Negotiation' }),
      directorUser,
    );
  });

  it('create passes a valid body through to the service', async () => {
    mockOpportunities.create.mockResolvedValue({ id: 'OP-1' });
    await adapter.create(validBody, directorUser);
    expect(mockOpportunities.create).toHaveBeenCalledWith(expect.objectContaining({ title: 'New weighbridge' }), directorUser);
  });

  describe('getRelated', () => {
    const query = { page: 1, limit: 20 };

    it.each([
      ['rfqs', mockRfqs],
      ['visits', mockSiteVisits],
      ['demos', mockEvaluations],
      ['costing', mockCostingSheets],
      ['quotes', mockQuotations],
      ['pos', mockPurchaseOrders],
    ])('delegates the \'%s\' tab to its own module, scoped to this opportunity', async (tabKey, mockService) => {
      mockService.findAll.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20, pages: 0 });
      await adapter.getRelated('OP-1', tabKey, query, directorUser);
      expect(mockService.findAll).toHaveBeenCalledWith({ ...query, opportunityId: 'OP-1' }, directorUser);
    });

    it('resolves the \'contacts\' tab via this opportunity\'s accountId (Contact has no opportunityId)', async () => {
      mockOpportunities.findOne.mockResolvedValue({ id: 'OP-1', accountId: 'A-1' });
      mockContacts.findAll.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20, pages: 0 });
      await adapter.getRelated('OP-1', 'contacts', query, directorUser);
      expect(mockContacts.findAll).toHaveBeenCalledWith({ ...query, accountId: 'A-1' }, directorUser);
    });
  });
});
