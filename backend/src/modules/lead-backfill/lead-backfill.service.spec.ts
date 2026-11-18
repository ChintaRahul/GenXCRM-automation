import { Test } from '@nestjs/testing';
import { LeadSource, Role } from '@prisma/client';
import { LeadBackfillService } from './lead-backfill.service';
import { PrismaService } from '../../prisma/prisma.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { DEFAULT_CORE_FIELD_ALIASES } from '../../common/utils/field-mapping.util';
import type { AuthUser } from '../../common/types/auth-user.type';

const caller = { id: 'u1', orgId: 'org-1', role: Role.DIRECTOR } as AuthUser;

const mockPrisma = {
  lead: { findMany: jest.fn(), update: jest.fn((args: unknown) => args) },
  $transaction: jest.fn().mockResolvedValue([]),
};
const mockOrganizations = {
  getFieldMappingsForOrg: jest.fn().mockResolvedValue({
    coreFieldAliases: { ...DEFAULT_CORE_FIELD_ALIASES, location: 'city', course: 'interested_course' },
    customFieldDefs: [{ id: 'cf-1', name: 'Budget', aliases: 'budget' }],
  }),
};

const lead = (over: Record<string, unknown> = {}) => ({
  id: 'l1',
  rawFields: { city: 'Pune', interested_course: 'NEET', budget: '5L' },
  altPhone: null,
  course: null,
  location: null,
  language: null,
  tags: [],
  customFields: null,
  ...over,
});

describe('LeadBackfillService', () => {
  let service: LeadBackfillService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.lead.findMany.mockResolvedValue([lead()]);
    const module = await Test.createTestingModule({
      providers: [
        LeadBackfillService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: OrganizationsService, useValue: mockOrganizations },
      ],
    }).compile();
    service = module.get(LeadBackfillService);
  });

  it('scopes the lead query to the caller org, non-deleted, with stored answers', async () => {
    await service.backfill({}, caller);
    expect(mockPrisma.lead.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1', isDeleted: false }) }),
    );
  });

  it('filters by the selected sources', async () => {
    await service.backfill({ sources: [LeadSource.FACEBOOK] }, caller);
    expect(mockPrisma.lead.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ source: { in: [LeadSource.FACEBOOK] } }) }),
    );
  });

  it('fills empty core and custom fields from the stored answers', async () => {
    const result = await service.backfill({}, caller);
    expect(mockPrisma.lead.update).toHaveBeenCalledWith({
      where: { id: 'l1' },
      data: { location: 'Pune', course: 'NEET', customFields: { 'cf-1': '5L' } },
    });
    expect(result).toEqual({ scanned: 1, updated: 1, skipped: 0 });
  });

  it('only fills the fields the user selected', async () => {
    await service.backfill({ fields: ['location'] }, caller);
    expect(mockPrisma.lead.update).toHaveBeenCalledWith({ where: { id: 'l1' }, data: { location: 'Pune' } });
  });

  it('never overwrites a value that is already set', async () => {
    mockPrisma.lead.findMany.mockResolvedValue([
      lead({ location: 'Delhi', course: 'JEE', customFields: { 'cf-1': '1L' } }),
    ]);
    const result = await service.backfill({}, caller);
    expect(mockPrisma.lead.update).not.toHaveBeenCalled();
    expect(result).toEqual({ scanned: 1, updated: 0, skipped: 1 });
  });
});
