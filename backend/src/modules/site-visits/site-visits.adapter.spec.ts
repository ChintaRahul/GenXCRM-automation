import { BadRequestException } from '@nestjs/common';
import { SiteVisitsAdapter } from './site-visits.adapter';
import type { AuthUser } from '../../common/types/auth-user.type';
import { Role } from '@prisma/client';

const mockRegistry = { register: jest.fn() } as never;
const mockVisits = { create: jest.fn(), update: jest.fn() };

const directorUser: AuthUser = { id: 'dir-1', name: 'Dir', email: 'dir@test.com', role: Role.DIRECTOR, teamId: null, orgId: 'org-1' };

const validBody = {
  title: 'Visit 1',
  accountId: 'acc-1',
  visitDate: '2026-01-01',
  objective: 'Inspection',
};

describe('SiteVisitsAdapter', () => {
  let adapter: SiteVisitsAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    adapter = new SiteVisitsAdapter(mockVisits as never, mockRegistry);
  });

  it('create rejects a body with a disallowed field (e.g. orgId) with BadRequestException', async () => {
    await expect(adapter.create({ ...validBody, orgId: 'evil-org' }, directorUser)).rejects.toThrow(BadRequestException);
    expect(mockVisits.create).not.toHaveBeenCalled();
  });

  it('create passes a valid body through to the service', async () => {
    mockVisits.create.mockResolvedValue({ id: 'visit-1' });
    await adapter.create(validBody, directorUser);
    expect(mockVisits.create).toHaveBeenCalledWith(expect.objectContaining({ title: 'Visit 1' }), directorUser);
  });
});
