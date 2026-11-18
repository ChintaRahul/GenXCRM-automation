import { createHmac } from 'node:crypto';
import { BadRequestException, Injectable, Logger, NotFoundException, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';
import type { ModuleEventItem, ModuleListQuery, ModulePaginatedResult } from '../../modules-framework/module-adapter.interface';
import { requireOrgId } from '../../modules-framework/utils/require-org-id.util';
import { ERP_ENTITIES, type CreateErpConnectionDto } from './dto/create-erp-connection.dto';
import type { UpdateErpConnectionDto } from './dto/update-erp-connection.dto';

const SYNC_EVERY_MS = 3_600_000;
const BATCH = 200;
const MASK = '••••••••';

// The secret signs every push (HMAC-SHA256, header X-GenXCRM-Signature) but is never sent back to a browser.
const redact = <T extends { secret: string }>(connection: T) => ({ ...connection, secret: MASK });

const assertEntities = (entities: string) => {
  const unknown = entities.split(',').map((entity) => entity.trim()).filter((entity) => !ERP_ENTITIES.includes(entity));
  if (unknown.length) throw new BadRequestException(`Unknown ERP entities: ${unknown.join(', ')}. Choose from ${ERP_ENTITIES.join(', ')}.`);
};

@Injectable()
export class ErpSyncService implements OnApplicationBootstrap, OnApplicationShutdown {
  readonly #logger = new Logger(ErpSyncService.name);
  #timer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV === 'test') return;
    this.#timer = setInterval(() => void this.syncAllActive(), SYNC_EVERY_MS);
    this.#timer.unref();
  }

  onApplicationShutdown(): void {
    clearInterval(this.#timer);
  }

  async findAll(query: ModuleListQuery, caller: AuthUser): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.ErpConnectionWhereInput = {
      orgId: requireOrgId(caller),
      isDeleted: false,
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.erpConnection.count({ where }),
      this.prisma.erpConnection.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: 'desc' } }),
    ]);
    return { data: rows.map(redact), total, page, limit, pages: Math.ceil(total / limit) };
  }

  private async findRaw(id: string, caller: AuthUser) {
    const record = await this.prisma.erpConnection.findFirst({ where: { id, orgId: requireOrgId(caller), isDeleted: false } });
    if (!record) throw new NotFoundException(`ERP connection '${id}' not found.`);
    return record;
  }

  async findOne(id: string, caller: AuthUser) {
    return redact(await this.findRaw(id, caller));
  }

  async create(dto: CreateErpConnectionDto, caller: AuthUser) {
    assertEntities(dto.entities);
    return redact(await this.prisma.erpConnection.create({ data: { ...dto, orgId: requireOrgId(caller), isActive: dto.isActive ?? true } }));
  }

  async update(id: string, dto: UpdateErpConnectionDto, caller: AuthUser) {
    await this.findRaw(id, caller);
    if (dto.entities) assertEntities(dto.entities);
    // The edit form shows the masked secret; sending it back unchanged must not overwrite the real one.
    const { secret, ...rest } = dto;
    return redact(await this.prisma.erpConnection.update({ where: { id }, data: { ...rest, ...(secret && secret !== MASK ? { secret } : {}) } }));
  }

  async archive(id: string, caller: AuthUser): Promise<void> {
    await this.findRaw(id, caller);
    await this.prisma.erpConnection.update({ where: { id }, data: { isDeleted: true } });
  }

  async performAction(id: string, action: string, _payload: Record<string, unknown> | undefined, caller: AuthUser) {
    const connection = await this.findRaw(id, caller);
    if (action === 'Sync now') {
      await this.sync(connection);
      return this.findOne(id, caller);
    }
    if (action === 'Pause' || action === 'Resume') {
      return redact(await this.prisma.erpConnection.update({ where: { id }, data: { isActive: action === 'Resume' } }));
    }
    throw new BadRequestException(`Unknown action '${action}' for ERP connections.`);
  }

  async getLogEvents(id: string, caller: AuthUser): Promise<ModuleEventItem[]> {
    const connection = await this.findRaw(id, caller);
    const logs = await this.prisma.erpSyncLog.findMany({ where: { connectionId: id, orgId: connection.orgId }, orderBy: { createdAt: 'desc' }, take: 100 });
    return logs.map((log) => ({
      id: log.id,
      at: log.createdAt.toISOString(),
      label: `${log.entity}: ${log.status} (${log.records})`,
      description: log.detail ?? undefined,
    }));
  }

  async syncAllActive(): Promise<void> {
    const connections = await this.prisma.erpConnection.findMany({ where: { isActive: true, isDeleted: false } });
    for (const connection of connections) {
      try {
        await this.sync(connection);
      } catch (err) {
        this.#logger.error(`ERP sync failed for connection ${connection.id}`, err instanceof Error ? err.stack : err);
      }
    }
  }

  // Pushes everything changed since the last sync, one signed POST per entity, and logs each outcome.
  // The watermark only moves when every entity went through, so a failed push is retried next time.
  async sync(connection: { id: string; orgId: string; endpointUrl: string; secret: string; entities: string; lastSyncAt: Date | null }): Promise<void> {
    const startedAt = new Date();
    let allOk = true;
    for (const entity of connection.entities.split(',').map((name) => name.trim()).filter(Boolean)) {
      const records = await this.collect(entity, connection.orgId, connection.lastSyncAt);
      if (!records.length) continue;
      const body = JSON.stringify({ entity, sentAt: startedAt.toISOString(), records });
      try {
        const response = await fetch(connection.endpointUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-GenXCRM-Signature': createHmac('sha256', connection.secret).update(body).digest('hex') },
          body,
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) throw new Error(`ERP answered ${response.status}`);
        await this.log(connection, entity, records.length, 'Sent');
      } catch (err) {
        allOk = false;
        await this.log(connection, entity, records.length, 'Failed', err instanceof Error ? err.message : 'Request failed');
      }
    }
    await this.prisma.erpConnection.update({
      where: { id: connection.id },
      data: { lastStatus: allOk ? 'OK' : 'Failed', ...(allOk ? { lastSyncAt: startedAt } : {}) },
    });
  }

  private log(connection: { id: string; orgId: string }, entity: string, records: number, status: string, detail?: string) {
    return this.prisma.erpSyncLog.create({ data: { orgId: connection.orgId, connectionId: connection.id, entity, records, status, detail } });
  }

  private async collect(entity: string, orgId: string, since: Date | null): Promise<Record<string, unknown>[]> {
    const changed = since ? { updatedAt: { gt: since } } : {};
    switch (entity) {
      case 'customers':
        return this.prisma.account.findMany({
          where: { orgId, isDeleted: false, ...changed },
          select: { id: true, name: true, gstin: true, type: true, billing: true, city: true, state: true },
          take: BATCH,
        });
      case 'items':
        return this.prisma.product.findMany({
          where: { orgId, isDeleted: false, ...changed },
          select: { id: true, sku: true, model: true, family: true, hsn: true, gstRate: true, uom: true, price: true },
          take: BATCH,
        });
      case 'orders':
        return this.prisma.salesOrder.findMany({
          where: { orgId, isDeleted: false, ...changed },
          select: { id: true, accountId: true, purchaseOrderId: true, value: true, status: true, committedDelivery: true, paymentTerms: true },
          take: BATCH,
        });
      case 'dispatches':
        return this.prisma.dispatch.findMany({
          where: { orgId, isDeleted: false, ...changed },
          select: { id: true, salesOrderId: true, accountId: true, invoiceNo: true, invoiceDate: true, dispatchDate: true, status: true },
          take: BATCH,
        });
      case 'receipts': {
        const receipts = await this.prisma.receipt.findMany({
          where: { paymentMilestone: { orgId }, ...(since ? { createdAt: { gt: since } } : {}) },
          select: { id: true, amount: true, receivedOn: true, paymentMilestone: { select: { id: true, salesOrderId: true, milestone: true } } },
          take: BATCH,
        });
        return receipts.map(({ paymentMilestone, ...receipt }) => ({ ...receipt, milestoneId: paymentMilestone.id, salesOrderId: paymentMilestone.salesOrderId, milestone: paymentMilestone.milestone }));
      }
      default:
        return [];
    }
  }
}
