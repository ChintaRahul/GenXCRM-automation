import { BadRequestException, NotFoundException } from '@nestjs/common';
import { QuotationsAdapter } from './quotations.adapter';
import type { AuthUser } from '../../common/types/auth-user.type';
import { Role } from '@prisma/client';

const mockRegistry = { register: jest.fn() } as never;
const mockQuotations = { create: jest.fn(), getVersionEvents: jest.fn(), findOne: jest.fn() };
const mockApprovals = { findAll: jest.fn() };
const mockActivities = { findAll: jest.fn() };

const directorUser: AuthUser = { id: 'dir-1', name: 'Dir', email: 'dir@test.com', role: Role.DIRECTOR, teamId: null, orgId: 'org-1' };

const validBody = {
  opportunityId: 'opp-1',
  accountId: 'acc-1',
  quotationDate: '2026-01-01',
  validUntil: '2026-02-01',
  paymentTerms: '100% advance',
};

describe('QuotationsAdapter', () => {
  let adapter: QuotationsAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    adapter = new QuotationsAdapter(mockQuotations as never, mockApprovals as never, mockActivities as never, mockRegistry);
  });

  it('create rejects a body with a disallowed field (e.g. orgId) with BadRequestException', async () => {
    await expect(adapter.create({ ...validBody, orgId: 'evil-org' }, directorUser)).rejects.toThrow(BadRequestException);
    expect(mockQuotations.create).not.toHaveBeenCalled();
  });

  it('create passes a valid body through to the service', async () => {
    mockQuotations.create.mockResolvedValue({ id: 'Q-1' });
    await adapter.create(validBody, directorUser);
    expect(mockQuotations.create).toHaveBeenCalledWith(expect.objectContaining({ opportunityId: 'opp-1' }), directorUser);
  });

  it('getEvents throws NotFoundException for invalid tabKey', async () => {
    await expect(adapter.getEvents('q-1', 'invalid', directorUser)).rejects.toThrow(NotFoundException);
    expect(mockQuotations.getVersionEvents).not.toHaveBeenCalled();
  });

  it('getRelated throws NotFoundException for invalid tabKey', async () => {
    await expect(
      adapter.getRelated('q-1', 'invalid', { page: 1, limit: 20 }, directorUser),
    ).rejects.toThrow(NotFoundException);
    expect(mockApprovals.findAll).not.toHaveBeenCalled();
    expect(mockActivities.findAll).not.toHaveBeenCalled();
  });
});
