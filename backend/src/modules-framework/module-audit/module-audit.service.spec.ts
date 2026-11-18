import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { ModuleAuditService } from './module-audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';

const caller: AuthUser = { id: 'u1', name: 'U', email: 'u@t.com', role: Role.MANAGER, teamId: null, orgId: 'org-1' };
const mockPrisma = { moduleAuditEntry: { createMany: jest.fn(), findMany: jest.fn() } };

describe('ModuleAuditService', () => {
  let service: ModuleAuditService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [ModuleAuditService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get(ModuleAuditService);
  });

  it('stores one org-scoped row per changed field, ignoring server-maintained fields', async () => {
    await service.recordChanges(
      'opps',
      'op-1',
      { id: 'op-1', stage: 'Qualified', value: 100, updatedAt: new Date('2026-01-01'), sla: { l: 'x' }, note: null },
      { id: 'op-1', stage: 'Costing', value: 100, updatedAt: new Date('2026-02-01'), sla: { l: 'y' }, note: 'hello' },
      caller,
    );
    expect(mockPrisma.moduleAuditEntry.createMany).toHaveBeenCalledWith({
      data: [
        { orgId: 'org-1', userId: 'u1', moduleKey: 'opps', recordId: 'op-1', field: 'stage', oldValue: 'Qualified', newValue: 'Costing' },
        { orgId: 'org-1', userId: 'u1', moduleKey: 'opps', recordId: 'op-1', field: 'note', oldValue: null, newValue: 'hello' },
      ],
    });
  });

  it('writes nothing when nothing changed', async () => {
    await service.recordChanges('opps', 'op-1', { id: 'op-1', stage: 'A' }, { id: 'op-1', stage: 'A' }, caller);
    expect(mockPrisma.moduleAuditEntry.createMany).not.toHaveBeenCalled();
  });

  it('never throws when the audit write fails, so the edit itself is unaffected', async () => {
    mockPrisma.moduleAuditEntry.createMany.mockRejectedValue(new Error('db down'));
    await expect(service.recordChanges('opps', 'op-1', { a: 1 }, { a: 2 }, caller)).resolves.toBeUndefined();
  });

  it('lists newest-first entries scoped to org, module and record, with the actor name', async () => {
    mockPrisma.moduleAuditEntry.findMany.mockResolvedValue([
      { id: 'e1', createdAt: new Date('2026-10-01T10:00:00Z'), user: { name: 'Asha' }, field: 'stage', oldValue: 'A', newValue: null },
    ]);
    const result = await service.list('opps', 'op-1', caller);
    expect(mockPrisma.moduleAuditEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orgId: 'org-1', moduleKey: 'opps', recordId: 'op-1' }, orderBy: { createdAt: 'desc' } }),
    );
    expect(result).toEqual([{ id: 'e1', at: '2026-10-01T10:00:00.000Z', user: 'Asha', field: 'stage', oldValue: 'A', newValue: '—' }]);
  });
});
