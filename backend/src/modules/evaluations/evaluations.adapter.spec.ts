import { BadRequestException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { EvaluationsAdapter } from './evaluations.adapter';
import type { AuthUser } from '../../common/types/auth-user.type';

const mockRegistry = { register: jest.fn() } as never;
const mockEvaluations = { create: jest.fn(), update: jest.fn() };

const directorUser: AuthUser = { id: 'dir-1', name: 'Dir', email: 'dir@test.com', role: Role.DIRECTOR, teamId: null, orgId: 'org-1' };

const validBody = {
  title: 'Eval 1',
  type: 'Demo',
  opportunityId: 'opp-1',
  accountId: 'acc-1',
  plannedDate: '2026-01-01',
};

describe('EvaluationsAdapter', () => {
  let adapter: EvaluationsAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    adapter = new EvaluationsAdapter(mockEvaluations as never, mockRegistry);
  });

  it('create rejects a body with a disallowed field (e.g. orgId) with BadRequestException', async () => {
    await expect(adapter.create({ ...validBody, orgId: 'evil-org' }, directorUser)).rejects.toThrow(BadRequestException);
    expect(mockEvaluations.create).not.toHaveBeenCalled();
  });

  it('create passes a valid body through to the service', async () => {
    mockEvaluations.create.mockResolvedValue({ id: 'eval-1' });
    await adapter.create(validBody, directorUser);
    expect(mockEvaluations.create).toHaveBeenCalledWith(expect.objectContaining({ title: 'Eval 1' }), directorUser);
  });
});
