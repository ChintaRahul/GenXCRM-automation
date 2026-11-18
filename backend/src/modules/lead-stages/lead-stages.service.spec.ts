import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { LeadStage, Role, type StageConfig } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';
import { LeadStagesService } from './lead-stages.service';

const caller = { id: 'u1', role: Role.DIRECTOR, orgId: 'org-1' } as AuthUser;

const customRow = (over: Partial<StageConfig> = {}): StageConfig =>
  ({
    id: 'c1',
    orgId: 'org-1',
    label: 'Site visit',
    color: 'teal',
    sortOrder: 55,
    isHidden: false,
    baseStage: null,
    countsAs: LeadStage.CONTACTED,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  }) as StageConfig;

describe('LeadStagesService', () => {
  let service: LeadStagesService;
  let prisma: {
    stageConfig: Record<string, jest.Mock>;
    lead: Record<string, jest.Mock>;
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      stageConfig: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        upsert: jest.fn(),
        delete: jest.fn(),
      },
      lead: { updateMany: jest.fn() },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    const module = await Test.createTestingModule({
      providers: [LeadStagesService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(LeadStagesService);
  });

  it('list merges defaults with overrides and custom stages ordered by sortOrder', async () => {
    prisma.stageConfig.findMany.mockResolvedValue([
      customRow(),
      customRow({ id: 'o1', baseStage: LeadStage.NEW, countsAs: null, label: 'Fresh', color: 'green', sortOrder: 100 }),
    ]);
    const result = await service.list(caller, true);
    expect(result).toHaveLength(Object.keys(LeadStage).length + 1);
    const sorted = result.map((s) => s.sortOrder);
    expect(sorted).toEqual([...sorted].sort((a, b) => a - b));
    const fresh = result.find((s) => s.key === 'NEW');
    expect(fresh).toMatchObject({ label: 'Fresh', color: 'green', id: 'o1', mandatory: true, isCustom: false });
    expect(result.find((s) => s.key === 'c1')).toMatchObject({ isCustom: true, countsAs: LeadStage.CONTACTED });
  });

  it('list scopes stageConfig.findMany by orgId', async () => {
    await service.list(caller, false);
    expect(prisma.stageConfig.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1' }) }),
    );
  });

  it('list omits hidden stages unless includeHidden', async () => {
    prisma.stageConfig.findMany.mockResolvedValue([
      customRow({ id: 'o2', baseStage: LeadStage.CONTACTED, countsAs: null, label: 'Contacted', isHidden: true }),
    ]);
    expect((await service.list(caller, false)).some((s) => s.key === 'CONTACTED')).toBe(false);
    expect((await service.list(caller, true)).some((s) => s.key === 'CONTACTED')).toBe(true);
  });

  it('create rejects duplicate label case-insensitively', async () => {
    prisma.stageConfig.findMany.mockResolvedValue([customRow()]);
    await expect(service.create({ label: 'SITE VISIT', color: 'blue', countsAs: LeadStage.NEW }, caller)).rejects.toThrow(
      ConflictException,
    );
  });

  it('create rejects when 30 custom stages exist', async () => {
    prisma.stageConfig.findMany.mockResolvedValue(
      Array.from({ length: 30 }, (_, i) => customRow({ id: `c${i}`, label: `Stage ${i}` })),
    );
    await expect(service.create({ label: 'One more', color: 'blue', countsAs: LeadStage.NEW }, caller)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('update on built-in key upserts override row with orgId', async () => {
    prisma.stageConfig.upsert.mockResolvedValue(
      customRow({ id: 'o1', baseStage: LeadStage.CONTACTED, countsAs: null, label: 'Reached' }),
    );
    const result = await service.update('CONTACTED', { label: 'Reached' }, caller);
    expect(prisma.stageConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orgId_baseStage: { orgId: 'org-1', baseStage: LeadStage.CONTACTED } },
        create: expect.objectContaining({ orgId: 'org-1', baseStage: LeadStage.CONTACTED, label: 'Reached' }),
      }),
    );
    expect(result.label).toBe('Reached');
  });

  it('update rejects hiding a mandatory stage', async () => {
    await expect(service.update('NEW', { isHidden: true }, caller)).rejects.toThrow(BadRequestException);
    expect(prisma.stageConfig.upsert).not.toHaveBeenCalled();
  });

  it("update/remove of another org's id throws NotFoundException", async () => {
    prisma.stageConfig.findMany.mockResolvedValue([]);
    prisma.stageConfig.findFirst.mockResolvedValue(null);
    await expect(service.update('other-org-id', { label: 'X' }, caller)).rejects.toThrow(NotFoundException);
    await expect(service.remove('other-org-id', caller)).rejects.toThrow(NotFoundException);
    expect(prisma.stageConfig.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1' }) }),
    );
  });

  it('remove nulls Lead.customStageId then deletes in one $transaction', async () => {
    prisma.stageConfig.findFirst.mockResolvedValue(customRow());
    await service.remove('c1', caller);
    expect(prisma.lead.updateMany).toHaveBeenCalledWith({
      where: { orgId: 'org-1', customStageId: 'c1' },
      data: { customStageId: null },
    });
    expect(prisma.stageConfig.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('remove rejects a built-in/override row', async () => {
    prisma.stageConfig.findFirst.mockResolvedValue(customRow({ baseStage: LeadStage.CONTACTED, countsAs: null }));
    await expect(service.remove('c1', caller)).rejects.toThrow(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('hiding a non-mandatory built-in does not touch leads', async () => {
    prisma.stageConfig.upsert.mockResolvedValue(
      customRow({ id: 'o2', baseStage: LeadStage.CONTACTED, countsAs: null, label: 'Contacted', isHidden: true }),
    );
    await service.update('CONTACTED', { isHidden: true }, caller);
    expect(prisma.lead.updateMany).not.toHaveBeenCalled();
  });

  describe('reorder', () => {
    const allKeys = Object.values(LeadStage) as string[];

    it('rejects a partial list', async () => {
      await expect(service.reorder(allKeys.slice(1), caller)).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects duplicate keys', async () => {
      await expect(service.reorder([...allKeys.slice(1), allKeys[1]], caller)).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects an unknown key with NotFoundException', async () => {
      await expect(service.reorder([...allKeys, 'nope'], caller)).rejects.toThrow(NotFoundException);
    });

    it('runs a valid full list in one $transaction', async () => {
      await service.reorder([...allKeys].reverse(), caller);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });
});
