import { BadRequestException } from '@nestjs/common';
import { MfgActivitiesAdapter } from './mfg-activities.adapter';
import type { AuthUser } from '../../common/types/auth-user.type';
import { Role } from '@prisma/client';

const mockRegistry = { register: jest.fn() } as never;
const mockActivities = { create: jest.fn(), update: jest.fn() };

const directorUser: AuthUser = { id: 'dir-1', name: 'Dir', email: 'dir@test.com', role: Role.DIRECTOR, teamId: null, orgId: 'org-1' };

const validBody = {
  type: 'Call',
  subject: 'Follow up',
  priority: 'High',
};

describe('MfgActivitiesAdapter', () => {
  let adapter: MfgActivitiesAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    adapter = new MfgActivitiesAdapter(mockActivities as never, mockRegistry);
  });

  it('create rejects a body with a disallowed field (e.g. orgId) with BadRequestException', async () => {
    await expect(adapter.create({ ...validBody, orgId: 'evil-org' }, directorUser)).rejects.toThrow(BadRequestException);
    expect(mockActivities.create).not.toHaveBeenCalled();
  });

  it('update rejects a status field (must go through performAction, not a plain PATCH)', async () => {
    await expect(adapter.update('T-1', { status: 'Completed' }, directorUser)).rejects.toThrow(BadRequestException);
    expect(mockActivities.update).not.toHaveBeenCalled();
  });

  it('create passes a valid body through to the service', async () => {
    mockActivities.create.mockResolvedValue({ id: 'T-1' });
    await adapter.create(validBody, directorUser);
    expect(mockActivities.create).toHaveBeenCalledWith(expect.objectContaining({ subject: 'Follow up' }), directorUser);
  });
});
