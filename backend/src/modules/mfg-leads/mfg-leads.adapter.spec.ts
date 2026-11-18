import { BadRequestException } from '@nestjs/common';
import { MfgLeadsAdapter } from './mfg-leads.adapter';
import type { AuthUser } from '../../common/types/auth-user.type';
import { Role } from '@prisma/client';

const mockRegistry = { register: jest.fn() } as never;
const mockLeads = { create: jest.fn(), update: jest.fn() };
const mockActivities = {};

const directorUser: AuthUser = { id: 'dir-1', name: 'Dir', email: 'dir@test.com', role: Role.DIRECTOR, teamId: null, orgId: 'org-1' };

const validBody = {
  company: 'Acme',
  contactName: 'Jo',
  phone: '9999999999',
  product: 'Conveyor',
  source: 'Website',
};

describe('MfgLeadsAdapter', () => {
  let adapter: MfgLeadsAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    adapter = new MfgLeadsAdapter(mockLeads as never, mockActivities as never, mockRegistry);
  });

  it('create rejects a body with a disallowed field (e.g. orgId) with BadRequestException', async () => {
    await expect(adapter.create({ ...validBody, orgId: 'evil-org' }, directorUser)).rejects.toThrow(BadRequestException);
    expect(mockLeads.create).not.toHaveBeenCalled();
  });

  it('create passes a valid body through to the service', async () => {
    mockLeads.create.mockResolvedValue({ id: 'LD-1' });
    await adapter.create(validBody, directorUser);
    expect(mockLeads.create).toHaveBeenCalledWith(expect.objectContaining({ company: 'Acme' }), directorUser);
  });
});
