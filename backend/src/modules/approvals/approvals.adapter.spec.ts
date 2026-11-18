import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ApprovalsAdapter } from './approvals.adapter';
import type { AuthUser } from '../../common/types/auth-user.type';
import { Role } from '@prisma/client';

const mockRegistry = { register: jest.fn() } as never;
const mockApprovals = { getChainEvents: jest.fn(), create: jest.fn() };

const directorUser: AuthUser = {
  id: 'u1',
  name: 'Director',
  email: 'dir@test.com',
  role: Role.DIRECTOR,
  teamId: null,
  orgId: 'org-1',
};

describe('ApprovalsAdapter', () => {
  let adapter: ApprovalsAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    adapter = new ApprovalsAdapter(mockApprovals as never, mockRegistry);
  });

  describe('create', () => {
    it('rejects a body containing a client-supplied requestedById (no longer a whitelisted field)', async () => {
      const body = {
        title: 'Test Approval',
        entityType: 'Quotation',
        entityId: 'quot-1',
        type: 'Discount',
        requestedById: 'someone-else',
      };

      await expect(adapter.create(body, directorUser)).rejects.toThrow(BadRequestException);
      expect(mockApprovals.create).not.toHaveBeenCalled();
    });
  });

  describe('getEvents', () => {
    it('getEvents("chain") delegates to getChainEvents', async () => {
      mockApprovals.getChainEvents.mockResolvedValue([
        { id: 'app-1-requested', at: '2026-01-01T10:00:00Z', label: 'Requested' },
      ]);

      const result = await adapter.getEvents('app-1', 'chain', directorUser);

      expect(mockApprovals.getChainEvents).toHaveBeenCalledWith('app-1', directorUser);
      expect(result).toHaveLength(1);
    });

    it('getEvents throws NotFoundException for invalid tabKey', async () => {
      await expect(adapter.getEvents('app-1', 'invalid', directorUser)).rejects.toThrow(NotFoundException);
    });
  });
});
