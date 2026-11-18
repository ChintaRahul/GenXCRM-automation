import { Injectable, Logger } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { mergeNotificationSettings } from '../../common/constants/org-defaults';

// Internal ops alert, not a customer-facing template — plain inline HTML.
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL ?? 'support@genxcrm.co.in';

// After an org's alert goes out, further failures wait this long and are sent as one digest
// (3 emails/day at most). A quiet window ends the cycle: the next failure alerts at once.
const ALERT_WINDOW_MS = 8 * 60 * 60 * 1000;
const SAMPLE_IDS = 5;

export interface IngestionFailureInput {
  readonly orgId?: string;
  readonly platform: string;
  readonly formId: string;
  readonly leadgenId: string;
  readonly reason: string;
}

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

@Injectable()
export class IngestionAlertsService {
  private readonly logger = new Logger(IngestionAlertsService.name);
  // Serialises work per org so a burst of simultaneous failures yields one alert, not many.
  readonly #locks = new Map<string, Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  /** Stores the failure; emails immediately only if the org has no alert window running. Never throws. */
  async recordFailure(input: IngestionFailureInput): Promise<void> {
    const { orgId, platform, formId, leadgenId, reason } = input;
    await this.#serialised(orgId, async () => {
      await this.prisma.ingestionFailure.create({ data: { orgId, platform, formId, leadgenId, reason } });
      if (!(await this.#windowOpen(orgId))) await this.#sendDigest(orgId);
    });
  }

  /** Tick entry point: sends a digest for every org with waiting failures and no open window. Never throws. */
  async sendDueDigests(): Promise<void> {
    try {
      const pending = await this.prisma.ingestionFailure.groupBy({ by: ['orgId'], where: { reportedAt: null } });
      for (const { orgId } of pending) {
        const id = orgId ?? undefined;
        await this.#serialised(id, async () => {
          if (!(await this.#windowOpen(id))) await this.#sendDigest(id);
        });
      }
    } catch (err) {
      this.logger.error('Failed to send due ingestion-failure digests', err instanceof Error ? err.message : String(err));
    }
  }

  async #serialised(orgId: string | undefined, work: () => Promise<void>): Promise<void> {
    const key = orgId ?? '';
    const previous = this.#locks.get(key) ?? Promise.resolve();
    const run = previous.then(async () => {
      try {
        await work();
      } catch (err) {
        this.logger.error('Ingestion-failure alerting failed', err instanceof Error ? err.message : String(err));
      }
    });
    this.#locks.set(key, run);
    await run;
    if (this.#locks.get(key) === run) this.#locks.delete(key);
  }

  async #windowOpen(orgId: string | undefined): Promise<boolean> {
    const since = new Date(Date.now() - ALERT_WINDOW_MS);
    const recent = await this.prisma.ingestionFailure.count({
      where: { orgId: orgId ?? null, reportedAt: { gt: since } },
    });
    return recent > 0;
  }

  async #sendDigest(orgId: string | undefined): Promise<void> {
    // Claim the waiting rows first so they can never be emailed twice.
    const claimedAt = new Date();
    const { count } = await this.prisma.ingestionFailure.updateMany({
      where: { orgId: orgId ?? null, reportedAt: null },
      data: { reportedAt: claimedAt },
    });
    if (count === 0) return;

    const [failures, org, directors] = await Promise.all([
      this.prisma.ingestionFailure.findMany({
        where: { orgId: orgId ?? null, reportedAt: claimedAt },
        orderBy: { createdAt: 'asc' },
      }),
      orgId
        ? this.prisma.organization.findUnique({ where: { id: orgId }, select: { name: true, notificationSettings: true } })
        : null,
      orgId ? this.prisma.user.findMany({ where: { orgId, role: Role.DIRECTOR, isActive: true }, select: { email: true } }) : [],
    ]);

    const total = failures.length;
    const noun = total === 1 ? 'lead' : 'leads';
    const byPlatform = this.#tally(failures.map((f) => f.platform));
    const byReason = this.#tally(failures.map((f) => f.reason)).slice(0, 5);
    const list = (rows: [string, number][]) =>
      `<ul>${rows.map(([label, n]) => `<li>${escapeHtml(label)} &mdash; ${n}</li>`).join('')}</ul>`;

    const supportHtml = `
      <p><b>${total} Meta ${noun} failed to be created in GenXCRM.</b></p>
      <p>Org: ${escapeHtml(org?.name ?? 'Unknown')} (${orgId ?? 'no orgId'})</p>
      <p>By platform:</p>${list(byPlatform)}
      <p>Top reasons:</p>${list(byReason)}
      <p>Sample leadgen IDs: ${failures.slice(0, SAMPLE_IDS).map((f) => `${f.leadgenId} (form ${f.formId})`).join(', ')}</p>
      <p>First failure: ${failures[0].createdAt.toISOString()} &mdash; last: ${failures.at(-1)?.createdAt.toISOString()}</p>
    `;
    await this.mail.send(SUPPORT_EMAIL, `[Lead ingestion failed] ${org?.name ?? 'Unknown org'} — ${total} ${noun}`, supportHtml);

    if (!org || !mergeNotificationSettings(org.notificationSettings).leadIngestionFailures.email) return;
    const directorHtml = `
      <p><b>${total} ${noun} from your Meta (Facebook/Instagram) ads could not be added to GenXCRM.</b></p>
      <p>Most common reasons:</p>${list(byReason)}
      <p>Please check your Facebook integration and lead forms in GenXCRM. Our team has also been alerted.
      You will get at most one such email every 8 hours. You can turn these emails off under
      Administration &rarr; Notifications.</p>
    `;
    await Promise.all(
      directors.map(({ email }) => this.mail.send(email, `Action needed: ${total} ${noun} failed to import`, directorHtml)),
    );
  }

  #tally(values: readonly string[]): [string, number][] {
    const counts = new Map<string, number>();
    for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]);
  }
}
