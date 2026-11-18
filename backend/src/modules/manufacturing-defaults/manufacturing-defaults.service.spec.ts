import { Test } from '@nestjs/testing';
import { ManufacturingDefaultsService } from './manufacturing-defaults.service';
import { PrismaService } from '../../prisma/prisma.service';

const mockPrisma = {
  rolePermission: { findFirst: jest.fn(), createMany: jest.fn() },
  fieldPermission: { createMany: jest.fn() },
  approvalRule: { createMany: jest.fn() },
  masterValue: { createMany: jest.fn() },
  businessCalendar: { create: jest.fn() },
  holiday: { createMany: jest.fn() },
  slaPolicy: { createMany: jest.fn() },
  report: { createMany: jest.fn() },
};

describe('ManufacturingDefaultsService', () => {
  let service: ManufacturingDefaultsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.businessCalendar.create.mockResolvedValue({ id: 'cal-1' });
    const module = await Test.createTestingModule({
      providers: [ManufacturingDefaultsService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get(ManufacturingDefaultsService);
  });

  it('is a no-op when the org already has RolePermission rows', async () => {
    mockPrisma.rolePermission.findFirst.mockResolvedValue({ id: 'existing' });
    await service.seedForOrg('org-1');
    expect(mockPrisma.rolePermission.createMany).not.toHaveBeenCalled();
    expect(mockPrisma.slaPolicy.createMany).not.toHaveBeenCalled();
  });

  it('seeds RolePermission with recordAccess and MfgRole values, scoped to the org', async () => {
    mockPrisma.rolePermission.findFirst.mockResolvedValue(null);
    await service.seedForOrg('org-1');
    const data = mockPrisma.rolePermission.createMany.mock.calls[0][0].data as Array<Record<string, unknown>>;
    expect(data.length).toBeGreaterThan(0);
    expect(data.every((r) => r.orgId === 'org-1')).toBe(true);
    expect(data.every((r) => ['OWN', 'TEAM', 'ALL'].includes(r.recordAccess as string))).toBe(true);
    const director = data.filter((r) => r.role === 'DIRECTOR');
    expect(director.length).toBeGreaterThan(0);
    expect(director.every((r) => r.canCreate && r.canRead && r.canUpdate && r.canDelete && r.canExport)).toBe(true);
    expect(director.every((r) => r.recordAccess === 'ALL')).toBe(true);
  });

  it('seeds a Sales Executive with OWN record access and read/create/update-only on most modules', async () => {
    mockPrisma.rolePermission.findFirst.mockResolvedValue(null);
    await service.seedForOrg('org-1');
    const data = mockPrisma.rolePermission.createMany.mock.calls[0][0].data as Array<Record<string, unknown>>;
    const salesExec = data.filter((r) => r.role === 'SALES_EXECUTIVE');
    expect(salesExec.every((r) => r.recordAccess === 'OWN')).toBe(true);
    const opps = salesExec.find((r) => r.moduleKey === 'opps');
    expect(opps).toMatchObject({ canCreate: true, canRead: true, canUpdate: true, canDelete: false, canExport: false });
    const reports = salesExec.find((r) => r.moduleKey === 'reports');
    expect(reports).toMatchObject({ canRead: true, canExport: true, canCreate: false });
  });

  it('seeds FieldPermission restricting the six field-security labels to non-privileged roles only', async () => {
    mockPrisma.rolePermission.findFirst.mockResolvedValue(null);
    await service.seedForOrg('org-1');
    const data = mockPrisma.fieldPermission.createMany.mock.calls[0][0].data as Array<{ fieldLabel: string; restrictedToRoles: string[] }>;
    expect(data).toHaveLength(6);
    const stdCost = data.find((r) => r.fieldLabel === 'Standard cost')!;
    expect(stdCost.restrictedToRoles).toContain('SALES_EXECUTIVE');
    expect(stdCost.restrictedToRoles).not.toContain('DIRECTOR');
    expect(stdCost.restrictedToRoles).not.toContain('SALES_HEAD');
    expect(stdCost.restrictedToRoles).not.toContain('COMMERCIAL_ESTIMATION');
  });

  it('seeds 8 ApprovalRule defaults with the Margin type matching the string already queried by CostingSheetsService', async () => {
    mockPrisma.rolePermission.findFirst.mockResolvedValue(null);
    await service.seedForOrg('org-1');
    const data = mockPrisma.approvalRule.createMany.mock.calls[0][0].data as Array<{ type: string; orgId: string }>;
    expect(data).toHaveLength(8);
    expect(data.filter((r) => r.type === 'Margin')).toHaveLength(2);
    expect(data.every((r) => r.orgId === 'org-1')).toBe(true);
  });

  it('seeds 13 MasterValue categories including stage probabilities as numericValue', async () => {
    mockPrisma.rolePermission.findFirst.mockResolvedValue(null);
    await service.seedForOrg('org-1');
    const data = mockPrisma.masterValue.createMany.mock.calls[0][0].data as Array<{ category: string; value: string; numericValue?: number }>;
    const categories = new Set(data.map((m) => m.category));
    expect(categories.size).toBe(13);
    const qualifiedStage = data.find((m) => m.category === 'stages' && m.value === 'Qualified');
    expect(qualifiedStage?.numericValue).toBe(10);
  });

  it('seeds one BusinessCalendar with 7 days and 5 Holidays', async () => {
    mockPrisma.rolePermission.findFirst.mockResolvedValue(null);
    await service.seedForOrg('org-1');
    expect(mockPrisma.businessCalendar.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ orgId: 'org-1', timezone: 'Asia/Kolkata' }) }),
    );
    const days = mockPrisma.businessCalendar.create.mock.calls[0][0].data.days;
    expect(days).toHaveLength(7);
    const holidayData = mockPrisma.holiday.createMany.mock.calls[0][0].data;
    expect(holidayData).toHaveLength(5);
  });

  it('seeds all 22 SlaPolicy defaults, scoped to the org and active', async () => {
    mockPrisma.rolePermission.findFirst.mockResolvedValue(null);
    await service.seedForOrg('org-1');
    const data = mockPrisma.slaPolicy.createMany.mock.calls[0][0].data as Array<Record<string, unknown>>;
    expect(data).toHaveLength(22);
    expect(data.every((p) => p.orgId === 'org-1' && p.isActive === true)).toBe(true);
    expect(data.map((p) => p.name)).toContain('Lead first response');
  });

  it('seeds all 25 standard Report rows, scoped to the org', async () => {
    mockPrisma.rolePermission.findFirst.mockResolvedValue(null);
    await service.seedForOrg('org-1');
    const data = mockPrisma.report.createMany.mock.calls[0][0].data as Array<Record<string, unknown>>;
    expect(data).toHaveLength(25);
    expect(data.every((r) => r.orgId === 'org-1')).toBe(true);
    expect(data.map((r) => r.name)).toContain('Lead source & campaign performance');
    expect(new Set(data.map((r) => r.category))).toEqual(
      new Set(['Leads', 'Pipeline', 'Performance', 'Quotes & orders', 'Sales', 'Finance', 'After-sales', 'Operations']),
    );
  });

  describe('seedForOrgSafely', () => {
    it('swallows a seeding failure and logs it rather than throwing', async () => {
      mockPrisma.rolePermission.findFirst.mockRejectedValue(new Error('db down'));
      await expect(service.seedForOrgSafely('org-1')).resolves.toBeUndefined();
    });
  });
});
