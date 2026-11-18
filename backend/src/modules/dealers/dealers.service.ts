import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';
import type { ModuleListQuery, ModulePaginatedResult, ModuleTableResult } from '../../modules-framework/module-adapter.interface';
import { parseModuleSort } from '../../modules-framework/utils/module-sort.util';
import { requireOrgId } from '../../modules-framework/utils/require-org-id.util';
import { canActAcrossOwners, resolveOwnerScope } from '../../modules-framework/utils/record-access.util';
import type { CreateDealerDto } from './dto/create-dealer.dto';
import type { CreateDealerDealDto } from './dto/create-dealer-deal.dto';
import type { UpdateDealerDto } from './dto/update-dealer.dto';

const MODULE_KEY = 'dealers';
const SORTABLE_FIELDS = ['name', 'territory', 'status', 'createdAt'];
// A registration protects the dealer's customer for this long.
const REGISTRATION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

const PLAIN_TRANSITIONS: Record<string, { to: string; when: string[] }> = {
  Deactivate: { to: 'Inactive', when: ['Active'] },
  Activate: { to: 'Active', when: ['Inactive'] },
};
// "Mark deal won" / "Mark deal lost" act on the dealer's registered deal for the customer named in the answer.
const DEAL_OUTCOMES: Record<string, string> = { 'Mark deal won': 'Won', 'Mark deal lost': 'Lost' };

@Injectable()
export class DealersService {
  constructor(private readonly prisma: PrismaService) {}

  private async scopeFilter(caller: AuthUser): Promise<Prisma.DealerWhereInput> {
    const orgFilter = caller.orgId ? { orgId: caller.orgId } : {};
    return { ...orgFilter, ...(await resolveOwnerScope(this.prisma, caller, MODULE_KEY)) };
  }

  // Registered / won deals and won value per dealer: the performance view.
  private async withPerformance<T extends { id: string }>(rows: T[]) {
    if (!rows.length) return [];
    const deals = await this.prisma.dealerDeal.groupBy({
      by: ['dealerId', 'status'],
      where: { dealerId: { in: rows.map((row) => row.id) } },
      _count: true,
      _sum: { value: true },
    });
    return rows.map((row) => {
      const mine = deals.filter((deal) => deal.dealerId === row.id);
      const won = mine.find((deal) => deal.status === 'Won');
      return {
        ...row,
        dealsRegistered: mine.reduce((sum, deal) => sum + deal._count, 0),
        dealsWon: won?._count ?? 0,
        wonValue: won?._sum.value ?? 0,
      };
    });
  }

  async findAll(query: ModuleListQuery, caller: AuthUser): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { field, direction } = parseModuleSort(query.sort, SORTABLE_FIELDS, 'createdAt');
    const where: Prisma.DealerWhereInput = {
      ...(await this.scopeFilter(caller)),
      isDeleted: false,
      ...(query.status?.length ? { status: { in: query.status } } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { territory: { contains: query.search, mode: 'insensitive' } },
              { phone: { contains: query.search } },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.dealer.count({ where }),
      this.prisma.dealer.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { [field]: direction } }),
    ]);
    return { data: await this.withPerformance(rows), total, page, limit, pages: Math.ceil(total / limit) };
  }

  async findOne(id: string, caller: AuthUser) {
    const record = await this.prisma.dealer.findFirst({ where: { id, ...(await this.scopeFilter(caller)), isDeleted: false } });
    if (!record) throw new NotFoundException(`Dealer '${id}' not found.`);
    const [withPerformance] = await this.withPerformance([record]);
    return withPerformance;
  }

  async create(dto: CreateDealerDto, caller: AuthUser) {
    const orgId = requireOrgId(caller);
    const clash = await this.prisma.dealer.findFirst({
      where: { orgId, isDeleted: false, name: { equals: dto.name.trim(), mode: 'insensitive' } },
      select: { name: true },
    });
    if (clash) throw new ConflictException(`A dealer called '${clash.name}' already exists.`);
    const ownerId = (await canActAcrossOwners(this.prisma, caller, MODULE_KEY)) ? (dto.ownerId ?? caller.id) : caller.id;
    return this.prisma.dealer.create({ data: { ...dto, name: dto.name.trim(), ownerId, orgId, status: 'Active' } });
  }

  async update(id: string, dto: UpdateDealerDto, caller: AuthUser) {
    await this.findOne(id, caller);
    return this.prisma.dealer.update({ where: { id }, data: dto });
  }

  async archive(id: string, caller: AuthUser): Promise<void> {
    await this.findOne(id, caller);
    await this.prisma.dealer.update({ where: { id }, data: { isDeleted: true } });
  }

  async performAction(id: string, action: string, payload: Record<string, unknown> | undefined, caller: AuthUser) {
    const record = await this.findOne(id, caller);
    const outcome = DEAL_OUTCOMES[action];
    if (outcome) {
      const customer = String(payload?.customer ?? '').trim();
      if (!customer) throw new BadRequestException(`'customer' is required to ${action}.`);
      const { count } = await this.prisma.dealerDeal.updateMany({
        where: { dealerId: id, orgId: record.orgId, status: 'Registered', customer: { equals: customer, mode: 'insensitive' } },
        data: { status: outcome },
      });
      if (!count) throw new BadRequestException(`No registered deal for '${customer}' on this dealer.`);
      return this.findOne(id, caller);
    }
    const transition = PLAIN_TRANSITIONS[action];
    if (!transition) throw new BadRequestException(`Unknown action '${action}' for dealers.`);
    if (!transition.when.includes(record.status)) {
      throw new BadRequestException(`Cannot ${action} a dealer in status '${record.status}'.`);
    }
    return this.prisma.dealer.update({ where: { id }, data: { status: transition.to } });
  }

  async getDealsTable(id: string, caller: AuthUser): Promise<ModuleTableResult> {
    const dealer = await this.findOne(id, caller);
    const deals = await this.prisma.dealerDeal.findMany({ where: { dealerId: id, orgId: dealer.orgId }, orderBy: { registeredOn: 'desc' } });
    const day = (date: Date) => date.toISOString().slice(0, 10);
    return {
      columns: [
        { key: 'customer', label: 'Customer', type: 'text' },
        { key: 'product', label: 'Product', type: 'text' },
        { key: 'value', label: 'Value', type: 'money' },
        { key: 'status', label: 'Status', type: 'text' },
        { key: 'registeredOn', label: 'Registered', type: 'date' },
        { key: 'expiresOn', label: 'Protected until', type: 'date' },
      ],
      rows: deals.map((deal) => ({
        id: deal.id,
        customer: deal.customer,
        product: deal.product,
        value: deal.value,
        status: deal.status,
        registeredOn: day(deal.registeredOn),
        expiresOn: day(deal.expiresOn),
      })),
    };
  }

  // Deal registration: a customer already protected by another open registration can't be registered again.
  async registerDeal(id: string, dto: CreateDealerDealDto, caller: AuthUser): Promise<void> {
    const dealer = await this.findOne(id, caller);
    if (dealer.status !== 'Active') throw new BadRequestException('Only an active dealer can register deals.');
    const customer = dto.customer.trim();
    const clash = await this.prisma.dealerDeal.findFirst({
      where: { orgId: dealer.orgId, status: 'Registered', expiresOn: { gt: new Date() }, customer: { equals: customer, mode: 'insensitive' } },
      include: { dealer: { select: { name: true } } },
    });
    if (clash) {
      throw new ConflictException(`'${customer}' is already registered by ${clash.dealer.name} until ${clash.expiresOn.toISOString().slice(0, 10)}.`);
    }
    await this.prisma.dealerDeal.create({
      data: {
        orgId: dealer.orgId,
        dealerId: id,
        customer,
        product: dto.product,
        value: dto.value,
        status: dto.status ?? 'Registered',
        notes: dto.notes,
        expiresOn: new Date(Date.now() + REGISTRATION_DAYS * DAY_MS),
      },
    });
  }

  async removeDeal(id: string, dealId: string, caller: AuthUser): Promise<void> {
    const dealer = await this.findOne(id, caller);
    await this.prisma.dealerDeal.deleteMany({ where: { id: dealId, dealerId: id, orgId: dealer.orgId } });
  }
}
