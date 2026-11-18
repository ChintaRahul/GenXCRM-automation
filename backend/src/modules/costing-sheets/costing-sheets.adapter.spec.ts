import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CostingSheetsAdapter } from './costing-sheets.adapter';
import type { AuthUser } from '../../common/types/auth-user.type';
import { Role } from '@prisma/client';

const mockRegistry = { register: jest.fn() } as never;
const mockCostingSheets = { create: jest.fn(), update: jest.fn(), getBreakdownTable: jest.fn() };

const directorUser: AuthUser = { id: 'dir-1', name: 'Dir', email: 'dir@test.com', role: Role.DIRECTOR, teamId: null, orgId: 'org-1' };

const validBody = {
  opportunityId: 'opp-1',
  sellingPrice: 50000,
};

describe('CostingSheetsAdapter', () => {
  let adapter: CostingSheetsAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    adapter = new CostingSheetsAdapter(mockCostingSheets as never, mockRegistry);
  });

  it('create rejects a body with a disallowed field (e.g. orgId) with BadRequestException', async () => {
    await expect(adapter.create({ ...validBody, orgId: 'evil-org' }, directorUser)).rejects.toThrow(BadRequestException);
    expect(mockCostingSheets.create).not.toHaveBeenCalled();
  });

  it('create passes a valid body through to the service', async () => {
    mockCostingSheets.create.mockResolvedValue({ id: 'cs-1' });
    await adapter.create(validBody, directorUser);
    expect(mockCostingSheets.create).toHaveBeenCalledWith(expect.objectContaining({ opportunityId: 'opp-1' }), directorUser);
  });

  describe('getTable', () => {
    it("getTable('breakdown') delegates to the service correctly", async () => {
      const mockTableResult = { columns: [], rows: [] };
      mockCostingSheets.getBreakdownTable.mockResolvedValue(mockTableResult);

      const result = await adapter.getTable('cs-1', 'breakdown', directorUser);

      expect(mockCostingSheets.getBreakdownTable).toHaveBeenCalledWith('cs-1', directorUser);
      expect(result).toEqual(mockTableResult);
    });

    it('getTable with invalid tabKey rejects with NotFoundException', async () => {
      await expect(adapter.getTable('cs-1', 'invalid', directorUser)).rejects.toThrow(NotFoundException);
    });
  });
});
