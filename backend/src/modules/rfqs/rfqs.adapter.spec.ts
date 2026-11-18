import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RfqsAdapter } from './rfqs.adapter';
import type { AuthUser } from '../../common/types/auth-user.type';
import { Role } from '@prisma/client';

const mockRegistry = { register: jest.fn() } as never;
const mockRfqs = { create: jest.fn(), update: jest.fn(), getRevisionEvents: jest.fn() };

const directorUser: AuthUser = { id: 'dir-1', name: 'Dir', email: 'dir@test.com', role: Role.DIRECTOR, teamId: null, orgId: 'org-1' };

const validBody = {
  custNo: 'C001',
  opportunityId: 'opp-1',
  accountId: 'acc-1',
  receivedOn: '2026-01-01',
  application: 'Test',
  product: 'Weighbridge',
};

describe('RfqsAdapter', () => {
  let adapter: RfqsAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    adapter = new RfqsAdapter(mockRfqs as never, mockRegistry);
  });

  it('create rejects a body with a disallowed field (e.g. orgId) with BadRequestException', async () => {
    await expect(adapter.create({ ...validBody, orgId: 'evil-org' }, directorUser)).rejects.toThrow(BadRequestException);
    expect(mockRfqs.create).not.toHaveBeenCalled();
  });

  it('create passes a valid body through to the service', async () => {
    mockRfqs.create.mockResolvedValue({ id: 'rfq-1' });
    await adapter.create(validBody, directorUser);
    expect(mockRfqs.create).toHaveBeenCalledWith(expect.objectContaining({ custNo: 'C001' }), directorUser);
  });

  it('getEvents throws NotFoundException for invalid tabKey', async () => {
    await expect(adapter.getEvents('rfq-1', 'invalid', directorUser)).rejects.toThrow(NotFoundException);
    expect(mockRfqs.getRevisionEvents).not.toHaveBeenCalled();
  });
});
