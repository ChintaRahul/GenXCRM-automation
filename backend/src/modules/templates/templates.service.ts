import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  BadGatewayException,
} from '@nestjs/common';
import { Prisma, TemplateChannel, IntegrationProvider, IntegrationStatus, type OrgIntegration } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { decryptToken } from '../../common/crypto.utils';
import type { CreateTemplateDto } from './dto/create-template.dto';
import type { UpdateTemplateDto } from './dto/update-template.dto';
import type { AuthUser } from '../../common/types/auth-user.type';
import { ErrorMessages } from '../../common/constants/messages';
import { PUBLIC_TEST_ONLY_TEMPLATE_NAMES } from '../../common/constants/whatsapp.constants';
import {
  WhatsappTemplatesApi,
  metaErrorText,
  type RemoteStatus,
  type WaCredentials,
} from '../../integrations/whatsapp/whatsapp-templates.api';

// Meta template names are lowercase snake_case (its own naming rule) — prettify for display when
// we import a template authored directly in WhatsApp Manager, where we have no other name to show.
const prettifyMetaName = (name: string) => name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

type WaStatus = 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED';

// Meta name must be lowercase [a-z0-9_]. Suffix with an org fragment + random token so the same
// friendly name across orgs (one shared WABA) never collides.
const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'template';

const mapMetaStatus = (raw: string): WaStatus => {
  const s = raw.toUpperCase();
  if (s === 'APPROVED') return 'APPROVED';
  if (['REJECTED', 'DISABLED', 'PAUSED', 'PENDING_DELETION'].includes(s)) return 'REJECTED';
  return 'PENDING';
};

@Injectable()
export class TemplatesService {
  private readonly logger = new Logger(TemplatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsappTemplatesApi,
  ) {}

  // Decrypts a connected org's stored WABA credentials for use with WhatsappTemplatesApi. Returns
  // undefined when the org has no WABA of its own connected (or decryption fails) — callers then
  // fall back to the global env-configured WABA.
  private credsFromIntegration(integration: Pick<OrgIntegration, 'status' | 'accessToken' | 'metadata'>): WaCredentials | undefined {
    if (integration.status !== IntegrationStatus.CONNECTED || !integration.accessToken) return undefined;
    const encryptedWabaId = (integration.metadata as { businessAccountId?: string } | null)?.businessAccountId;
    if (!encryptedWabaId) return undefined;
    try {
      return { accessToken: decryptToken(integration.accessToken), businessAccountId: decryptToken(encryptedWabaId) };
    } catch (err) {
      this.logger.error('Failed to decrypt WhatsApp template credentials', err instanceof Error ? err.message : String(err));
      return undefined;
    }
  }

  // Prefers the caller's org's own connected WABA; undefined falls back to the global env vars.
  private async resolveWaCredentials(caller: AuthUser): Promise<WaCredentials | undefined> {
    if (!caller.orgId) return undefined;
    const integration = await this.prisma.orgIntegration.findUnique({
      where: { orgId_provider: { orgId: caller.orgId, provider: IntegrationProvider.WHATSAPP } },
    });
    return integration ? this.credsFromIntegration(integration) : undefined;
  }

  // Returns global read-only defaults (isSystem) plus the caller's own org templates,
  // optionally narrowed to a single channel (email / whatsapp).
  findAll(caller: AuthUser, channel?: TemplateChannel) {
    return this.prisma.messageTemplate.findMany({
      where: {
        OR: [{ isSystem: true }, { orgId: caller.orgId ?? undefined }],
        ...(channel && { channel }),
        // metaTemplateName is null for non-WhatsApp templates — plain "notIn" would silently
        // exclude those rows too under SQL NULL semantics, so allow null explicitly.
        AND: [{ OR: [{ metaTemplateName: null }, { metaTemplateName: { notIn: [...PUBLIC_TEST_ONLY_TEMPLATE_NAMES] } }] }],
      },
      orderBy: [{ isSystem: 'desc' }, { updatedAt: 'desc' }],
      include: { createdBy: { select: { id: true, name: true } } },
    });
  }

  // A template is visible if it's a global default or belongs to the caller's org.
  async findOne(id: string, caller: AuthUser) {
    const template = await this.prisma.messageTemplate.findFirst({
      where: { id, OR: [{ isSystem: true }, { orgId: caller.orgId ?? undefined }] },
      include: { createdBy: { select: { id: true, name: true } } },
    });
    if (!template) throw new NotFoundException(ErrorMessages.templates.notFound);
    return template;
  }

  async create(dto: CreateTemplateDto, caller: AuthUser) {
    if (dto.channel !== TemplateChannel.WHATSAPP) {
      return this.prisma.messageTemplate.create({
        data: {
          channel: dto.channel,
          name: dto.name,
          subject: dto.subject,
          body: dto.body,
          orgId: caller.orgId ?? undefined,
          createdById: caller.id,
        },
      });
    }

    // WhatsApp: submit to Meta for approval on creation (degrades to DRAFT when not configured).
    const language = dto.language ?? 'en_US';
    const category = dto.category ?? 'MARKETING';
    const orgPart = (caller.orgId ?? 'sys').replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 8);
    const metaTemplateName = `${slugify(dto.name)}_${orgPart}_${Math.random().toString(36).slice(2, 6)}`;

    const creds = await this.resolveWaCredentials(caller);
    const submission = await this.submitToMeta({ metaTemplateName, language, category, body: dto.body }, creds);

    return this.prisma.messageTemplate.create({
      data: {
        channel: TemplateChannel.WHATSAPP,
        name: dto.name,
        body: dto.body,
        orgId: caller.orgId ?? undefined,
        createdById: caller.id,
        language,
        category,
        metaTemplateName,
        status: submission.status,
        metaTemplateId: submission.metaTemplateId,
        rejectionReason: submission.rejectionReason,
        variables: submission.variables,
      },
    });
  }

  async update(id: string, dto: UpdateTemplateDto, caller: AuthUser) {
    const template = await this.findOne(id, caller);
    if (template.isSystem) {
      throw new ForbiddenException(ErrorMessages.templates.defaultCannotEdit);
    }

    if (template.channel !== TemplateChannel.WHATSAPP) {
      return this.prisma.messageTemplate.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.subject !== undefined && { subject: dto.subject }),
          ...(dto.body !== undefined && { body: dto.body }),
        },
      });
    }

    // WhatsApp: can't edit while Meta is reviewing it.
    if (template.status === 'PENDING') {
      throw new ForbiddenException(ErrorMessages.templates.pendingCannotEdit);
    }

    const body = dto.body ?? template.body;
    const category = dto.category ?? template.category ?? 'MARKETING';
    const language = dto.language ?? template.language ?? 'en_US';
    const contentChanged =
      (dto.body !== undefined && dto.body !== template.body) ||
      (dto.category !== undefined && dto.category !== template.category);

    // Content edits must be re-approved; a name-only edit leaves approval untouched.
    const resubmit = contentChanged
      ? await this.submitToMeta(
          {
            metaTemplateName: template.metaTemplateName ?? `${slugify(dto.name ?? template.name)}_${Math.random().toString(36).slice(2, 6)}`,
            language,
            category,
            body,
            metaTemplateId: template.metaTemplateId ?? undefined,
          },
          await this.resolveWaCredentials(caller),
        )
      : null;

    return this.prisma.messageTemplate.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        body,
        category,
        language,
        ...(resubmit && {
          status: resubmit.status,
          metaTemplateId: resubmit.metaTemplateId,
          rejectionReason: resubmit.rejectionReason,
          variables: resubmit.variables,
        }),
      },
    });
  }

  // (Re)submit a DRAFT/REJECTED WhatsApp template — the retry path after fixing content or config.
  async submit(id: string, caller: AuthUser) {
    const template = await this.findOne(id, caller);
    if (template.isSystem) throw new ForbiddenException(ErrorMessages.templates.defaultCannotEdit);
    if (template.channel !== TemplateChannel.WHATSAPP) {
      throw new BadRequestException(ErrorMessages.templates.notWhatsapp);
    }
    const creds = await this.resolveWaCredentials(caller);
    if (!this.whatsapp.isConfigured(creds)) {
      throw new BadRequestException(ErrorMessages.templates.notConfigured);
    }
    const submission = await this.submitToMeta(
      {
        metaTemplateName: template.metaTemplateName ?? `${slugify(template.name)}_${Math.random().toString(36).slice(2, 6)}`,
        language: template.language ?? 'en_US',
        category: template.category ?? 'MARKETING',
        body: template.body,
        metaTemplateId: template.metaTemplateId ?? undefined,
      },
      creds,
    );
    return this.prisma.messageTemplate.update({
      where: { id },
      data: {
        status: submission.status,
        metaTemplateName: template.metaTemplateName ?? undefined,
        metaTemplateId: submission.metaTemplateId,
        rejectionReason: submission.rejectionReason,
        variables: submission.variables,
      },
    });
  }

  // Pull current statuses from Meta, update the caller's known WhatsApp templates, and import any
  // template that already exists on the connected WhatsApp Business Account but isn't tracked yet
  // (e.g. authored directly in WhatsApp Manager before/outside GenXCRM). Powers the manual
  // "Refresh status" button; returns the refreshed WhatsApp list. Throws BadGatewayException with
  // Meta's own error text on failure, instead of a bare 500 — mirrors submitToMeta's degrade
  // pattern, but this path has no local DRAFT row to degrade onto, so it must surface the error.
  async refreshStatuses(caller: AuthUser) {
    const creds = await this.resolveWaCredentials(caller);
    let remote: Map<string, RemoteStatus>;
    try {
      remote = await this.whatsapp.fetchStatuses(creds);
    } catch (err) {
      throw new BadGatewayException(metaErrorText(err));
    }
    if (remote.size > 0) {
      const mine = await this.prisma.messageTemplate.findMany({
        where: {
          channel: TemplateChannel.WHATSAPP,
          metaTemplateName: { not: null },
          OR: [{ isSystem: true }, { orgId: caller.orgId ?? undefined }],
        },
      });
      await this.applyRemoteStatuses(mine, remote);
      await this.importUnknownTemplates(remote, mine, caller);
    }
    return this.findAll(caller, TemplateChannel.WHATSAPP);
  }

  // Scheduled poll: refresh PENDING WhatsApp templates for every org with its own connected WABA
  // (each org's pending templates checked against that org's own WABA, since each is a distinct
  // Meta account), then sweep every remaining org (no WABA of its own) against the global env
  // fallback in one shot. No-op branches when neither is configured.
  async syncPendingStatuses() {
    const connectedIntegrations = await this.prisma.orgIntegration.findMany({
      where: { provider: IntegrationProvider.WHATSAPP, status: IntegrationStatus.CONNECTED },
    });

    const handledOrgIds: string[] = [];
    for (const integration of connectedIntegrations) {
      const creds = this.credsFromIntegration(integration);
      if (!creds) continue;
      handledOrgIds.push(integration.orgId);
      try {
        const remote = await this.whatsapp.fetchStatuses(creds);
        if (remote.size === 0) continue;
        const pending = await this.prisma.messageTemplate.findMany({
          where: {
            channel: TemplateChannel.WHATSAPP,
            status: 'PENDING',
            metaTemplateName: { not: null },
            orgId: integration.orgId,
          },
        });
        await this.applyRemoteStatuses(pending, remote);
      } catch (err) {
        this.logger.error(`WhatsApp template sync failed for org ${integration.orgId}`, metaErrorText(err));
      }
    }

    if (!this.whatsapp.isConfigured()) return;
    try {
      const remote = await this.whatsapp.fetchStatuses();
      if (remote.size === 0) return;
      const pending = await this.prisma.messageTemplate.findMany({
        where: {
          channel: TemplateChannel.WHATSAPP,
          status: 'PENDING',
          metaTemplateName: { not: null },
          // SQL NULL semantics: "orgId NOT IN (...)" alone would silently exclude every
          // null-orgId (isSystem) template, so pick those up explicitly via OR.
          OR: [{ orgId: null }, { orgId: { notIn: handledOrgIds } }],
        },
      });
      await this.applyRemoteStatuses(pending, remote);
    } catch (err) {
      this.logger.error('WhatsApp template sync failed for global fallback', metaErrorText(err));
    }
  }

  private async applyRemoteStatuses(
    templates: { id: string; metaTemplateName: string | null }[],
    remote: Map<string, { status: string; category?: string; rejectionReason?: string }>,
  ) {
    await Promise.all(
      templates.map((t) => {
        const r = t.metaTemplateName ? remote.get(t.metaTemplateName) : undefined;
        if (!r) return undefined;
        const status = mapMetaStatus(r.status);
        return this.prisma.messageTemplate.update({
          where: { id: t.id },
          data: {
            status,
            ...(r.category && { category: r.category }),
            rejectionReason: status === 'REJECTED' ? (r.rejectionReason ?? 'Rejected by WhatsApp') : null,
          },
        });
      }),
    );
  }

  // Creates a local row for every WABA template the caller's org doesn't already track (matched by
  // metaTemplateName). Lets onboarding an existing WhatsApp Business Account — one with templates
  // already approved in WhatsApp Manager — surface them in GenXCRM instead of only showing
  // templates created through this app.
  private async importUnknownTemplates(
    remote: Map<string, RemoteStatus>,
    known: { metaTemplateName: string | null }[],
    caller: AuthUser,
  ) {
    const knownNames = new Set(known.map((t) => t.metaTemplateName));
    const toImport = [...remote.entries()].filter(
      ([name]) => !knownNames.has(name) && !PUBLIC_TEST_ONLY_TEMPLATE_NAMES.has(name),
    );
    if (toImport.length === 0) return;

    await this.prisma.messageTemplate.createMany({
      data: toImport.map(([name, r]) => {
        const status = mapMetaStatus(r.status);
        return {
          channel: TemplateChannel.WHATSAPP,
          name: prettifyMetaName(name),
          body: r.body,
          orgId: caller.orgId ?? undefined,
          language: r.language,
          category: r.category ?? 'MARKETING',
          metaTemplateName: name,
          metaTemplateId: r.metaTemplateId,
          status,
          rejectionReason: status === 'REJECTED' ? (r.rejectionReason ?? 'Rejected by WhatsApp') : null,
          variables: Array.from({ length: r.variableCount }, (_, i) => `value${i + 1}`),
        };
      }),
    });
  }

  // Calls Meta to create/edit a template, returning the fields to persist. Never throws — a Meta
  // error or missing config lands the template as DRAFT with a reason so the user can retry.
  private async submitToMeta(
    input: {
      metaTemplateName: string;
      language: string;
      category: string;
      body: string;
      metaTemplateId?: string;
    },
    creds?: WaCredentials,
  ): Promise<{
    status: WaStatus;
    metaTemplateId: string | null;
    rejectionReason: string | null;
    variables: Prisma.InputJsonValue;
  }> {
    const variables = this.whatsapp.toPositional(input.body).variables;
    if (!this.whatsapp.isConfigured(creds)) {
      return {
        status: 'DRAFT',
        metaTemplateId: input.metaTemplateId ?? null,
        rejectionReason: ErrorMessages.templates.notConfigured,
        variables,
      };
    }
    try {
      if (input.metaTemplateId) {
        await this.whatsapp.edit(input.metaTemplateId, { category: input.category, body: input.body }, creds);
        return { status: 'PENDING', metaTemplateId: input.metaTemplateId, rejectionReason: null, variables };
      }
      const res = await this.whatsapp.submit(
        {
          metaName: input.metaTemplateName,
          language: input.language,
          category: input.category,
          body: input.body,
        },
        creds,
      );
      return { status: 'PENDING', metaTemplateId: res.id, rejectionReason: null, variables: res.variables };
    } catch (err) {
      return {
        status: 'DRAFT',
        metaTemplateId: input.metaTemplateId ?? null,
        rejectionReason: metaErrorText(err),
        variables,
      };
    }
  }

  async remove(id: string, caller: AuthUser) {
    const template = await this.findOne(id, caller);
    if (template.isSystem) {
      throw new ForbiddenException(ErrorMessages.templates.defaultCannotDelete);
    }
    await this.prisma.messageTemplate.delete({ where: { id } });
  }

  // Duplicates any visible template into a new editable org template. WhatsApp copies start as a
  // DRAFT (not auto-submitted) so the user can tweak before sending for approval.
  async copy(id: string, caller: AuthUser) {
    const template = await this.findOne(id, caller);
    const isWa = template.channel === TemplateChannel.WHATSAPP;
    return this.prisma.messageTemplate.create({
      data: {
        channel: template.channel,
        name: `Copy of ${template.name}`,
        subject: template.subject,
        body: template.body,
        orgId: caller.orgId ?? undefined,
        createdById: caller.id,
        ...(isWa && {
          language: template.language ?? 'en_US',
          category: template.category ?? 'MARKETING',
          status: 'DRAFT',
          rejectionReason: null,
          variables: this.whatsapp.toPositional(template.body).variables,
        }),
      },
    });
  }
}
