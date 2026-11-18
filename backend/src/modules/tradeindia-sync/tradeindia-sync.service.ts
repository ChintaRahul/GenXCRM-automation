import { Injectable, Logger } from '@nestjs/common';
import { IntegrationProvider, IntegrationStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { decryptToken } from '../../common/crypto.utils';
import { HubsService } from '../../integrations/hubs/hubs.service';
import { fetchTradeIndiaEnquiries } from './tradeindia.client';

const FIRST_SYNC_DAYS = 3;
const OVERLAP_MS = 60 * 60 * 1000; // re-read the last hour; duplicates are dropped by enquiry id

@Injectable()
export class TradeIndiaSyncService {
  private readonly logger = new Logger(TradeIndiaSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly hubs: HubsService,
  ) {}

  // One org failing (bad link, TradeIndia down) must never stop the others.
  async syncAll(): Promise<void> {
    const integrations = await this.prisma.orgIntegration.findMany({
      where: { provider: IntegrationProvider.TRADEINDIA, accessToken: { not: null }, status: { not: IntegrationStatus.DISCONNECTED } },
      select: { id: true, orgId: true, accessToken: true, lastSyncedAt: true, org: { select: { workspaceType: true } } },
    });
    for (const { id, orgId, accessToken, lastSyncedAt, org } of integrations) {
      const now = new Date();
      const from = lastSyncedAt ? new Date(lastSyncedAt.getTime() - OVERLAP_MS) : new Date(now.getTime() - FIRST_SYNC_DAYS * 86_400_000);
      try {
        const enquiries = await fetchTradeIndiaEnquiries(decryptToken(accessToken!), from, now);
        const result = await this.hubs.ingest('tradeindia', enquiries, orgId, org.workspaceType);
        await this.prisma.orgIntegration.update({ where: { id }, data: { status: IntegrationStatus.CONNECTED, lastSyncedAt: now } });
        this.logger.log(`TradeIndia sync orgId=${orgId}: ${JSON.stringify(result)}`);
      } catch (err) {
        await this.prisma.orgIntegration.update({ where: { id }, data: { status: IntegrationStatus.ERROR } });
        this.logger.error(`TradeIndia sync failed for orgId=${orgId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}
