import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import type { AuthUser } from '../../common/types/auth-user.type';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { UpdateOrgSettingsDto } from './dto/update-org-settings.dto';
import { UpdateFieldMappingsDto } from './dto/update-field-mappings.dto';
import { UploadOrgLogoDto } from './dto/upload-org-logo.dto';
import { QueryAuditLogDto } from './dto/query-audit-log.dto';
import { ErrorMessages } from '../../common/constants/messages';
import {
  DEFAULT_SECURITY_SETTINGS,
  mergeNotificationSettings,
  DEFAULT_ROUTING_SETTINGS,
  DEFAULT_PAYMENT_SETTINGS,
  SESSION_TIMEOUT_MIN_MINUTES,
  SESSION_TIMEOUT_MAX_MINUTES,
} from '../../common/constants/org-defaults';
import { DEFAULT_CORE_FIELD_ALIASES, normalizeFieldOrder, type CustomFieldDef } from '../../common/utils/field-mapping.util';

// Cap on how many distinct unmapped source-form field names we remember per org — a
// rolling window (most-recently-seen kept) so a noisy/misconfigured source can't grow
// this without bound.
const MAX_DETECTED_FIELDS = 50;

// Fields safe to expose to the client after an org update — mirrors the `org`
// shape returned by AuthService.me so the frontend can merge it into context.
const ORG_PUBLIC_SELECT = {
  id: true,
  name: true,
  website: true,
  workspaceType: true,
  industry: true,
  size: true,
  city: true,
  state: true,
  country: true,
  timezone: true,
  planStatus: true,
  trialEndsAt: true,
  gstNumber: true,
  notifyRepOnAssignment: true,
  email: true,
  phone: true,
  // logoKey is deliberately excluded — it's a raw S3 key, never handed to the client
  // (CLAUDE.md rule 6). The frontend gets a signed URL via getLogoDownloadUrl instead.
} satisfies Prisma.OrganizationSelect;

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  #requireOrgId(caller: AuthUser): string {
    if (!caller.orgId) {
      throw new ForbiddenException(ErrorMessages.organizations.noOrgLinked);
    }
    return caller.orgId;
  }

  // Returns the org profile shown on the Administration > Organization tab.
  async getProfile(caller: AuthUser) {
    const orgId = this.#requireOrgId(caller);
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: ORG_PUBLIC_SELECT,
    });
    if (!org) {
      throw new NotFoundException(ErrorMessages.organizations.notFound);
    }
    return org;
  }

  // Updates the caller's own organization. Tenant-scoped to caller.orgId — a
  // caller can never touch another org's record.
  async updateOwnOrg(dto: UpdateOrganizationDto, caller: AuthUser) {
    const orgId = this.#requireOrgId(caller);

    const data: Prisma.OrganizationUpdateInput = {};
    if (dto.gstNumber !== undefined) {
      const normalized = dto.gstNumber?.trim().toUpperCase();
      data.gstNumber = normalized ? normalized : null;
    }
    if (dto.notifyRepOnAssignment !== undefined) {
      data.notifyRepOnAssignment = dto.notifyRepOnAssignment;
    }
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.website !== undefined) data.website = dto.website;
    if (dto.industry !== undefined) data.industry = dto.industry;
    if (dto.size !== undefined) data.size = dto.size;
    if (dto.city !== undefined) data.city = dto.city;
    if (dto.state !== undefined) data.state = dto.state;
    if (dto.timezone !== undefined) data.timezone = dto.timezone;
    if (dto.email !== undefined) data.email = dto.email || null;
    if (dto.phone !== undefined) data.phone = dto.phone || null;

    return this.prisma.organization.update({
      where: { id: orgId },
      data,
      select: ORG_PUBLIC_SELECT,
    });
  }

  // Key is built + persisted server-side, never accepted from the client — same reasoning
  // as InvoicesService.getRegistrationScreenshotUploadUrl (trusting a client-supplied key
  // would let a caller attach an arbitrary object, including another tenant's, as their logo).
  async getLogoUploadUrl(dto: UploadOrgLogoDto, caller: AuthUser) {
    const orgId = this.#requireOrgId(caller);
    const ext = dto.contentType.split('/')[1] ?? 'png';
    const key = this.storage.buildOrgLogoKey(orgId, ext);
    const uploadUrl = await this.storage.getPresignedUploadUrl(key, dto.contentType);
    await this.prisma.organization.update({ where: { id: orgId }, data: { logoKey: key } });
    return { uploadUrl };
  }

  // Mints a fresh signed URL on every call — never cache (CLAUDE.md rule 6).
  async getLogoDownloadUrl(caller: AuthUser) {
    const orgId = this.#requireOrgId(caller);
    const org = await this.prisma.organization.findUnique({ where: { id: orgId }, select: { logoKey: true } });
    if (!org?.logoKey) return { url: null };
    const url = await this.storage.getPresignedDownloadUrl(org.logoKey);
    return { url };
  }

  // Returns the security/notification/routing/payments settings shown on the
  // Administration > Settings tabs, merging stored blobs with defaults.
  async getSettings(caller: AuthUser) {
    const orgId = this.#requireOrgId(caller);
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        securitySettings: true,
        notificationSettings: true,
        routingSettings: true,
        paymentSettings: true,
      },
    });
    return {
      security: { ...DEFAULT_SECURITY_SETTINGS, ...((org?.securitySettings as object) ?? {}) },
      notifications: mergeNotificationSettings(org?.notificationSettings),
      routing: { ...DEFAULT_ROUTING_SETTINGS, ...((org?.routingSettings as object) ?? {}) },
      payments: { ...DEFAULT_PAYMENT_SETTINGS, ...((org?.paymentSettings as object) ?? {}) },
    };
  }

  // Director-only: each section is saved as a full replacement blob by its
  // own tab's "Save changes" button — no per-key partial merge needed.
  async updateSettings(dto: UpdateOrgSettingsDto, caller: AuthUser) {
    const orgId = this.#requireOrgId(caller);
    const data: Prisma.OrganizationUpdateInput = {};
    if (dto.security !== undefined) {
      const sessionTimeoutMinutes = dto.security.sessionTimeoutMinutes;
      if (
        sessionTimeoutMinutes !== undefined &&
        (typeof sessionTimeoutMinutes !== 'number' ||
          sessionTimeoutMinutes < SESSION_TIMEOUT_MIN_MINUTES ||
          sessionTimeoutMinutes > SESSION_TIMEOUT_MAX_MINUTES)
      ) {
        throw new BadRequestException(ErrorMessages.organizations.invalidSessionTimeout);
      }
      data.securitySettings = { ...DEFAULT_SECURITY_SETTINGS, ...dto.security } as Prisma.InputJsonValue;
    }
    if (dto.notifications !== undefined) {
      data.notificationSettings = mergeNotificationSettings(dto.notifications) as Prisma.InputJsonValue;
    }
    if (dto.routing !== undefined) {
      data.routingSettings = { ...DEFAULT_ROUTING_SETTINGS, ...dto.routing } as Prisma.InputJsonValue;
    }
    if (dto.payments !== undefined) {
      const merged = { ...DEFAULT_PAYMENT_SETTINGS, ...dto.payments };
      if (merged.emiReminderTemplateId) {
        const template = await this.prisma.messageTemplate.findFirst({
          where: {
            id: merged.emiReminderTemplateId,
            orgId,
            channel: 'WHATSAPP',
            status: 'APPROVED',
          },
          select: { id: true },
        });
        if (!template) throw new BadRequestException(ErrorMessages.organizations.invalidEmiReminderTemplate);
      }
      if (merged.emiReminderEmailTemplateId) {
        const template = await this.prisma.messageTemplate.findFirst({
          where: { id: merged.emiReminderEmailTemplateId, orgId, channel: 'EMAIL' },
          select: { id: true },
        });
        if (!template) throw new BadRequestException(ErrorMessages.organizations.invalidEmiReminderEmailTemplate);
      }
      data.paymentSettings = merged as Prisma.InputJsonValue;
    }
    const org = await this.prisma.organization.update({
      where: { id: orgId },
      data,
      select: {
        securitySettings: true,
        notificationSettings: true,
        routingSettings: true,
        paymentSettings: true,
      },
    });
    return {
      security: { ...DEFAULT_SECURITY_SETTINGS, ...((org.securitySettings as object) ?? {}) },
      notifications: mergeNotificationSettings(org.notificationSettings),
      routing: { ...DEFAULT_ROUTING_SETTINGS, ...((org.routingSettings as object) ?? {}) },
      payments: { ...DEFAULT_PAYMENT_SETTINGS, ...((org.paymentSettings as object) ?? {}) },
    };
  }

  // Returns the core-field alias map, custom field definitions, and detected-but-unmapped
  // source field names, used by the Administration > Field Mappings screen.
  async getFieldMappings(caller: AuthUser) {
    const orgId = this.#requireOrgId(caller);
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { coreFieldAliases: true, customFieldDefs: true, fieldOrder: true, detectedFormFields: true },
    });
    return {
      coreFieldAliases: { ...DEFAULT_CORE_FIELD_ALIASES, ...((org?.coreFieldAliases as object) ?? {}) },
      customFieldDefs: (org?.customFieldDefs as CustomFieldDef[] | null) ?? [],
      fieldOrder: normalizeFieldOrder(org?.fieldOrder, (org?.customFieldDefs as CustomFieldDef[] | null) ?? []),
      detectedFields: (org?.detectedFormFields as string[] | null) ?? [],
    };
  }

  // Director-only: replaces core-field aliases and/or custom field
  // definitions. Each section is written only when present in the DTO.
  async updateFieldMappings(dto: UpdateFieldMappingsDto, caller: AuthUser) {
    const orgId = this.#requireOrgId(caller);
    const data: Prisma.OrganizationUpdateInput = {};
    if (dto.coreFieldAliases !== undefined) {
      data.coreFieldAliases = { ...DEFAULT_CORE_FIELD_ALIASES, ...dto.coreFieldAliases } as Prisma.InputJsonValue;
    }
    if (dto.customFieldDefs !== undefined) {
      data.customFieldDefs = dto.customFieldDefs as unknown as Prisma.InputJsonValue;
    }
    if (dto.fieldOrder !== undefined) {
      data.fieldOrder = dto.fieldOrder as unknown as Prisma.InputJsonValue;
    }
    const org = await this.prisma.organization.update({
      where: { id: orgId },
      data,
      select: { coreFieldAliases: true, customFieldDefs: true, fieldOrder: true, detectedFormFields: true },
    });
    return {
      coreFieldAliases: { ...DEFAULT_CORE_FIELD_ALIASES, ...((org.coreFieldAliases as object) ?? {}) },
      customFieldDefs: (org.customFieldDefs as CustomFieldDef[] | null) ?? [],
      fieldOrder: normalizeFieldOrder(org.fieldOrder, (org.customFieldDefs as CustomFieldDef[] | null) ?? []),
      detectedFields: (org.detectedFormFields as string[] | null) ?? [],
    };
  }

  // Internal — no caller/orgId scoping check, since this is used by lead-ingestion
  // paths (Facebook, Google, generic webhook) that act on a specific org's inbound
  // data before any authenticated user is involved. Never expose over HTTP directly.
  async getFieldMappingsForOrg(orgId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { coreFieldAliases: true, customFieldDefs: true },
    });
    return {
      coreFieldAliases: { ...DEFAULT_CORE_FIELD_ALIASES, ...((org?.coreFieldAliases as object) ?? {}) },
      customFieldDefs: (org?.customFieldDefs as CustomFieldDef[] | null) ?? [],
    };
  }

  // Internal — called fire-and-forget from lead-ingestion paths (Facebook, Google, generic
  // webhook) whenever a raw source field didn't match any configured core/custom alias, so
  // the Field Mappings screen can suggest real field names instead of the admin guessing
  // exact header text. Never throws — a failure here must not affect lead ingestion. Keeps
  // only the most recently seen MAX_DETECTED_FIELDS names, newest first, deduped
  // case-insensitively (first-seen casing wins).
  async recordDetectedFields(orgId: string, keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    try {
      const org = await this.prisma.organization.findUnique({
        where: { id: orgId },
        select: { detectedFormFields: true },
      });
      const existing = (org?.detectedFormFields as string[] | null) ?? [];
      const seen = new Set(existing.map((k) => k.toLowerCase()));
      const additions = keys.filter((k) => !seen.has(k.toLowerCase()));
      if (additions.length === 0) return;

      const merged = [...additions, ...existing].slice(0, MAX_DETECTED_FIELDS);
      await this.prisma.organization.update({
        where: { id: orgId },
        data: { detectedFormFields: merged as unknown as Prisma.InputJsonValue },
      });
    } catch {
      // Best-effort only — suggestions are a convenience, not load-bearing.
    }
  }

  // Returns a paginated, newest-first audit log for the caller's org, scoped
  // through the AuditLog.user relation (AuditLog has no direct orgId field).
  async getAuditLog(query: QueryAuditLogDto, caller: AuthUser) {
    const orgId = this.#requireOrgId(caller);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.AuditLogWhereInput = { user: { orgId } };

    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { user: { select: { name: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        action: row.action,
        userName: row.user.name,
        time: row.createdAt,
        ipAddress: row.ipAddress,
      })),
      total,
      page,
      pageSize,
    };
  }

  #generateApiKey(): string {
    return `gxc_live_${randomBytes(24).toString('hex')}`;
  }

  // Lazily generates and persists an API key on first access — the frontend
  // handles masked display and reveal/hide as a client-only toggle.
  async getApiKey(caller: AuthUser) {
    const orgId = this.#requireOrgId(caller);
    const org = await this.prisma.organization.findUnique({ where: { id: orgId }, select: { apiKey: true } });
    if (org?.apiKey) return { apiKey: org.apiKey };

    const apiKey = this.#generateApiKey();
    await this.prisma.organization.update({ where: { id: orgId }, data: { apiKey } });
    return { apiKey };
  }

  // Director-only: always overwrites with a freshly generated key.
  async regenerateApiKey(caller: AuthUser) {
    const orgId = this.#requireOrgId(caller);
    const apiKey = this.#generateApiKey();
    const org = await this.prisma.organization.update({
      where: { id: orgId },
      data: { apiKey },
      select: { apiKey: true },
    });
    return { apiKey: org.apiKey as string };
  }
}
