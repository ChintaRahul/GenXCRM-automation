import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';
import type { ModuleListQuery, ModulePaginatedResult } from '../../modules-framework/module-adapter.interface';
import { parseModuleSort } from '../../modules-framework/utils/module-sort.util';
import { requireOrgId } from '../../modules-framework/utils/require-org-id.util';
import { canActAcrossOwners, resolveOwnerScope } from '../../modules-framework/utils/record-access.util';
import type { CreateTenderDto } from './dto/create-tender.dto';
import type { UpdateTenderDto } from './dto/update-tender.dto';

const MODULE_KEY = 'tenders';
const SORTABLE_FIELDS = ['title', 'submissionDeadline', 'estimatedValue', 'status', 'createdAt'];

const PLAIN_TRANSITIONS: Record<string, { to: string; when: string[]; requires?: string }> = {
  'Start preparing': { to: 'Preparing', when: ['Identified'] },
  'Submit tender': { to: 'Submitted', when: ['Preparing'] },
  'Mark won': { to: 'Won', when: ['Submitted'] },
  'Mark lost': { to: 'Lost', when: ['Submitted'], requires: 'note' },
  Withdraw: { to: 'Withdrawn', when: ['Identified', 'Preparing'], requires: 'note' },
};
// EMD (earnest money deposit) moves through its own small flow, independent of the tender status.
const EMD_TRANSITIONS: Record<string, { to: string; when: string[] }> = {
  'Mark EMD paid': { to: 'Paid', when: ['Pending'] },
  'Mark EMD refunded': { to: 'Refunded', when: ['Paid'] },
  'Mark EMD forfeited': { to: 'Forfeited', when: ['Paid'] },
};
// A tender can't go out until its core documents and both bids are ready.
const SUBMISSION_CHECKLIST: { key: 'docsReady' | 'technicalBidReady' | 'financialBidReady'; label: string }[] = [
  { key: 'docsReady', label: 'Documents' },
  { key: 'technicalBidReady', label: 'Technical bid' },
  { key: 'financialBidReady', label: 'Financial bid' },
];

@Injectable()
export class TendersService {
  constructor(private readonly prisma: PrismaService) {}

  private async scopeFilter(caller: AuthUser): Promise<Prisma.TenderWhereInput> {
    const orgFilter = caller.orgId ? { orgId: caller.orgId } : {};
    return { ...orgFilter, ...(await resolveOwnerScope(this.prisma, caller, MODULE_KEY)) };
  }

  async findAll(query: ModuleListQuery, caller: AuthUser): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { field, direction } = parseModuleSort(query.sort, SORTABLE_FIELDS, 'submissionDeadline');
    const where: Prisma.TenderWhereInput = {
      ...(await this.scopeFilter(caller)),
      isDeleted: false,
      ...(query.status?.length ? { status: { in: query.status } } : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { tenderNo: { contains: query.search, mode: 'insensitive' } },
              { authority: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [total, data] = await Promise.all([
      this.prisma.tender.count({ where }),
      this.prisma.tender.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { [field]: direction } }),
    ]);
    return { data, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async findOne(id: string, caller: AuthUser) {
    const record = await this.prisma.tender.findFirst({ where: { id, ...(await this.scopeFilter(caller)), isDeleted: false } });
    if (!record) throw new NotFoundException(`Tender '${id}' not found.`);
    return record;
  }

  private async assertLinksInOrg(dto: { accountId?: string; opportunityId?: string }, caller: AuthUser): Promise<void> {
    const orgId = requireOrgId(caller);
    if (dto.accountId && !(await this.prisma.account.findFirst({ where: { id: dto.accountId, orgId }, select: { id: true } }))) {
      throw new BadRequestException(`Account '${dto.accountId}' not found in your organization.`);
    }
    if (dto.opportunityId && !(await this.prisma.opportunity.findFirst({ where: { id: dto.opportunityId, orgId }, select: { id: true } }))) {
      throw new BadRequestException(`Opportunity '${dto.opportunityId}' not found in your organization.`);
    }
  }

  async create(dto: CreateTenderDto, caller: AuthUser) {
    await this.assertLinksInOrg(dto, caller);
    const ownerId = (await canActAcrossOwners(this.prisma, caller, MODULE_KEY)) ? (dto.ownerId ?? caller.id) : caller.id;
    return this.prisma.tender.create({
      data: {
        ...dto,
        ownerId,
        orgId: requireOrgId(caller),
        status: 'Identified',
        emdStatus: dto.emdAmount && dto.emdAmount > 0 ? 'Pending' : 'Not required',
        submissionDeadline: new Date(dto.submissionDeadline),
        ...(dto.publishedOn ? { publishedOn: new Date(dto.publishedOn) } : {}),
        ...(dto.openingDate ? { openingDate: new Date(dto.openingDate) } : {}),
      },
    });
  }

  async update(id: string, dto: UpdateTenderDto, caller: AuthUser) {
    await this.findOne(id, caller);
    await this.assertLinksInOrg(dto, caller);
    return this.prisma.tender.update({
      where: { id },
      data: {
        ...dto,
        ...(dto.submissionDeadline ? { submissionDeadline: new Date(dto.submissionDeadline) } : {}),
        ...(dto.publishedOn ? { publishedOn: new Date(dto.publishedOn) } : {}),
        ...(dto.openingDate ? { openingDate: new Date(dto.openingDate) } : {}),
      },
    });
  }

  async archive(id: string, caller: AuthUser): Promise<void> {
    await this.findOne(id, caller);
    await this.prisma.tender.update({ where: { id }, data: { isDeleted: true } });
  }

  async performAction(id: string, action: string, payload: Record<string, unknown> | undefined, caller: AuthUser) {
    const record = await this.findOne(id, caller);
    const emd = EMD_TRANSITIONS[action];
    if (emd) {
      if (!emd.when.includes(record.emdStatus)) throw new BadRequestException(`Cannot ${action} while EMD is '${record.emdStatus}'.`);
      return this.prisma.tender.update({ where: { id }, data: { emdStatus: emd.to } });
    }
    const transition = PLAIN_TRANSITIONS[action];
    if (!transition) throw new BadRequestException(`Unknown action '${action}' for tenders.`);
    if (!transition.when.includes(record.status)) throw new BadRequestException(`Cannot ${action} a tender in status '${record.status}'.`);
    const note = String(payload?.note ?? '').trim();
    if (transition.requires && !note) throw new BadRequestException(`'${transition.requires}' is required to ${action}.`);
    if (action === 'Submit tender') {
      const missing = SUBMISSION_CHECKLIST.filter((item) => !record[item.key]).map((item) => item.label);
      if (missing.length) throw new BadRequestException(`Tick ${missing.join(', ')} on the checklist before submitting.`);
      if (record.emdStatus === 'Pending') throw new BadRequestException('Pay the EMD (and mark it paid) before submitting.');
      if (record.submissionDeadline.getTime() < Date.now()) throw new BadRequestException('The submission deadline has passed.');
    }
    return this.prisma.tender.update({ where: { id }, data: { status: transition.to, ...(note ? { outcomeNote: note } : {}) } });
  }
}
