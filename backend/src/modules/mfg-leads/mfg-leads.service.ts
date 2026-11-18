import { BadRequestException, ConflictException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';
import type { ModuleImportResult, ModuleListQuery, ModulePaginatedResult } from '../../modules-framework/module-adapter.interface';
import { buildListFilters, computeFacets, type FacetDelegate, type ModuleFilterConfig } from '../../modules-framework/utils/list-filters.util';
import { parseModuleSort } from '../../modules-framework/utils/module-sort.util';
import { requireOrgId } from '../../modules-framework/utils/require-org-id.util';
import { canActAcrossOwners, resolveOwnerScope } from '../../modules-framework/utils/record-access.util';
import { validateBody } from '../../modules-framework/utils/validate-body.util';
import { SlaEngineService } from '../sla-timers/sla-engine.service';
import { MfgNurturingService } from '../nurturing/mfg-nurturing.service';
import { AutomationEngineService } from '../automation-rules/automation-engine.service';
import { CreateMfgLeadDto, PRODUCTS, SOURCES } from './dto/create-mfg-lead.dto';
import type { UpdateMfgLeadDto } from './dto/update-mfg-lead.dto';

const ENTITY_TYPE = 'MfgLead';

const MODULE_KEY = 'leads';
const LIST_FILTERS = {
  moduleKey: 'leads',
  entityType: ENTITY_TYPE,
  ownerField: 'ownerId',
  valueField: 'value',
  facetFields: ['industry', 'product', 'source', 'timeline', 'qBudget', 'qAuth', 'qNeed', 'qTime'],
} satisfies ModuleFilterConfig;
const SORTABLE_FIELDS = ['company', 'status', 'value', 'createdAt'];

// Finished leads leave the default list; they stay reachable through the status filter.
const DONE_STATUSES = ['Disqualified', 'Converted'];
const OPEN_STATUSES = ['New', 'Assigned', 'Contacted', 'Follow-up', 'Nurture', 'Qualified'];
// Budget, Authority, Need and Timeline must be captured before a lead can be Qualified.
const BANT_FIELDS: { key: 'qBudget' | 'qAuth' | 'qNeed' | 'qTime'; label: string }[] = [
  { key: 'qBudget', label: 'Budget' },
  { key: 'qAuth', label: 'Authority' },
  { key: 'qNeed', label: 'Need' },
  { key: 'qTime', label: 'Timeline' },
];

// Body of the org's webhook ingest URL, for Manufacturing workspaces.
export interface MfgLeadWebhookPayload {
  external_id?: string;
  name?: string;
  company?: string;
  phone?: string;
  email?: string;
  product?: string;
  source?: string;
  requirement?: string;
  city?: string;
  state?: string;
}

// A validation failure carries a list of messages; join them into one readable reason.
const importErrorReason = (err: unknown): string => {
  if (err instanceof HttpException) {
    const { message } = err.getResponse() as { message?: string | string[] };
    return Array.isArray(message) ? message.join('; ') : (message ?? err.message);
  }
  return err instanceof Error ? err.message : 'Could not import this row.';
};

const matchOption = (options: readonly string[], value: string | undefined) =>
  options.find((option) => option.toLowerCase() === value?.trim().toLowerCase());

const PLAIN_TRANSITIONS: Record<string, { to: string; when: string[]; requires?: 'disq' }> = {
  'Mark contacted': { to: 'Contacted', when: ['New', 'Assigned'] },
  Qualify: { to: 'Qualified', when: ['Contacted', 'Follow-up', 'Nurture'] },
  'Move to nurture': { to: 'Nurture', when: ['Contacted', 'Follow-up'] },
  Disqualify: { to: 'Disqualified', when: ['New', 'Assigned', 'Contacted', 'Follow-up', 'Nurture'], requires: 'disq' },
};

// Fields a merge copies onto the kept lead only when the kept lead has nothing there.
const MERGEABLE_FIELDS = ['designation', 'email', 'city', 'state', 'industry', 'requirement', 'campaign', 'value', 'timeline'] as const;

@Injectable()
export class MfgLeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly slaEngine: SlaEngineService,
    private readonly nurturing: MfgNurturingService,
    private readonly automation: AutomationEngineService,
  ) {}

  private async withSlaState<T extends { id: string; orgId: string }>(record: T): Promise<T & { sla: unknown }> {
    return { ...record, sla: await this.slaEngine.getSlaState(record.orgId, ENTITY_TYPE, record.id) };
  }

  private async scopeFilter(caller: AuthUser): Promise<Prisma.MfgLeadWhereInput> {
    const orgFilter = caller.orgId ? { orgId: caller.orgId } : {};
    return { ...orgFilter, ...(await resolveOwnerScope(this.prisma, caller, MODULE_KEY)) };
  }

  private async baseWhere(query: ModuleListQuery, caller: AuthUser): Promise<Prisma.MfgLeadWhereInput> {
    return {
      ...(await this.scopeFilter(caller)),
      isDeleted: false,
      ...(query.search
        ? { OR: [
              { id: { contains: query.search.trim(), mode: 'insensitive' } },
              { company: { contains: query.search, mode: 'insensitive' } },
              { phone: { contains: query.search } },
              { email: { contains: query.search, mode: 'insensitive' } },
            ] }
        : {}),
    };
  }

  async getFacets(query: ModuleListQuery, caller: AuthUser) {
    return computeFacets(this.prisma, this.prisma.mfgLead as unknown as FacetDelegate, await this.baseWhere(query, caller), caller, LIST_FILTERS);
  }

  async findAll(query: ModuleListQuery, caller: AuthUser): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { field, direction } = parseModuleSort(query.sort, SORTABLE_FIELDS, 'createdAt');

    const where: Prisma.MfgLeadWhereInput = {
      ...(await this.baseWhere(query, caller)),
      ...(await buildListFilters(this.prisma, query, caller, LIST_FILTERS)),
      // No status chosen: show the working list, not leads that are already done with.
      ...(query.status?.length ? {} : { status: { notIn: DONE_STATUSES } }),
    };

    const [total, rows] = await Promise.all([
      this.prisma.mfgLead.count({ where }),
      this.prisma.mfgLead.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { [field]: direction } }),
    ]);
    const data = await Promise.all(rows.map((row) => this.withSlaState(row)));

    return { data, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async findOne(id: string, caller: AuthUser) {
    const record = await this.prisma.mfgLead.findFirst({ where: { id, ...(await this.scopeFilter(caller)), isDeleted: false } });
    if (!record) throw new NotFoundException(`Lead '${id}' not found.`);
    return this.withSlaState(record);
  }

  // The same phone or email is the same enquiry: open the existing lead instead of adding another.
  private async assertNotDuplicate(dto: { phone?: string; email?: string }, caller: AuthUser, excludeId?: string): Promise<void> {
    const phone = dto.phone?.trim();
    const email = dto.email?.trim().toLowerCase();
    if (!phone && !email) return;
    const clash = await this.prisma.mfgLead.findFirst({
      where: {
        orgId: requireOrgId(caller),
        isDeleted: false,
        ...(excludeId ? { id: { not: excludeId } } : {}),
        OR: [...(phone ? [{ phone }] : []), ...(email ? [{ email: { equals: email, mode: 'insensitive' as const } }] : [])],
      },
      select: { id: true, company: true },
    });
    if (clash) {
      throw new ConflictException(`A lead with the same phone or email already exists: ${clash.company} (LD-${clash.id.replace(/-/g, '').slice(0, 6).toUpperCase()}).`);
    }
  }

  // Auto-assignment: the active Sales Executive with the fewest open leads (no counter to keep in sync).
  private async pickAssignee(orgId: string): Promise<string | null> {
    const execs = await this.prisma.user.findMany({
      where: { orgId, mfgRole: 'SALES_EXECUTIVE', isActive: true },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    if (execs.length === 0) return null;
    const counts = await this.prisma.mfgLead.groupBy({
      by: ['ownerId'],
      where: { orgId, isDeleted: false, status: { in: OPEN_STATUSES }, ownerId: { in: execs.map((e) => e.id) } },
      _count: { _all: true },
    });
    const load = new Map(counts.map((c) => [c.ownerId, c._count._all]));
    return execs.reduce((best, e) => ((load.get(e.id) ?? 0) < (load.get(best.id) ?? 0) ? e : best)).id;
  }

  async create(dto: CreateMfgLeadDto, caller: AuthUser) {
    await this.assertNotDuplicate(dto, caller);
    const crossOwner = await canActAcrossOwners(this.prisma, caller, MODULE_KEY);
    // A manager who doesn't pick an owner hands the lead to the least-loaded Sales Executive.
    const autoOwner = crossOwner && !dto.ownerId ? await this.pickAssignee(requireOrgId(caller)) : null;
    const ownerId = crossOwner ? (dto.ownerId ?? autoOwner ?? caller.id) : caller.id;
    const lead = await this.prisma.mfgLead.create({
      data: {
        ...dto,
        ownerId,
        orgId: requireOrgId(caller),
        status: autoOwner ? 'Assigned' : 'New',
        ...(dto.nextDate ? { nextDate: new Date(dto.nextDate) } : {}),
      },
    });
    // SLA-01 'Lead first response': starts the moment a lead is created. `source` drives its
    // "Source = IndiaMART or Google Ads" target, `value` drives its "Estimated value ≥ ₹50 L" one.
    await this.slaEngine.startTimer(lead.orgId, MODULE_KEY, ENTITY_TYPE, lead.id, 'Lead created', lead.source ?? undefined, lead.value ?? undefined);
    await this.nurturing.enroll(lead.orgId, 'mfg_lead_created', ENTITY_TYPE, lead.id);
    await this.automation.fire(lead.orgId, 'Lead created', { link: `/leads/${lead.id}`, title: `New lead: ${lead.company}`, ownerId: lead.ownerId, value: lead.value });
    return lead;
  }

  // CSV import: each row goes through the same validation and duplicate rules as a manually created lead.
  // Product and source are matched ignoring case; a blank source becomes 'Manual / API'.
  async importLeads(rows: Record<string, unknown>[], caller: AuthUser): Promise<ModuleImportResult> {
    const result: ModuleImportResult = { imported: 0, duplicates: 0, errors: [] };
    const text = (value: unknown) => String(value ?? '').trim() || undefined;
    for (const [index, row] of rows.entries()) {
      try {
        const value = text(row.value)?.replace(/[₹,\s]/g, '');
        const dto = await validateBody(CreateMfgLeadDto, {
          company: text(row.company),
          contactName: text(row.contactName),
          phone: text(row.phone),
          email: text(row.email),
          city: text(row.city),
          state: text(row.state),
          requirement: text(row.requirement),
          product: matchOption(PRODUCTS, text(row.product)) ?? text(row.product),
          source: matchOption(SOURCES, text(row.source)) ?? text(row.source) ?? 'Manual / API',
          ...(value ? { value: Number(value) } : {}),
        });
        await this.create(dto, caller);
        result.imported += 1;
      } catch (err) {
        if (err instanceof ConflictException) result.duplicates += 1;
        else result.errors.push({ row: index + 1, reason: importErrorReason(err) });
      }
    }
    return result;
  }

  // Webhook / website enquiry: no signed-in user, so the org comes from the ingest URL. The same
  // external id, phone or email returns the existing lead instead of adding a second one.
  async ingest(payload: MfgLeadWebhookPayload, orgId: string, options: { freeTextProduct?: boolean } = {}): Promise<{ duplicate: true; leadId: string } | Awaited<ReturnType<MfgLeadsService['create']>>> {
    const contactName = payload.name?.trim();
    const company = payload.company?.trim() || contactName;
    const digits = (payload.phone ?? '').replace(/\D/g, '');
    const phone = digits.slice(-10);
    const email = payload.email?.trim().toLowerCase();
    const externalId = payload.external_id?.toString().trim() || undefined;
    if (!contactName || !phone) throw new BadRequestException('name and phone are required.');
    // Marketplace enquiries name products we don't stock-list; keep their wording instead of rejecting.
    const product = matchOption(PRODUCTS, payload.product) ?? (options.freeTextProduct ? payload.product?.trim() || 'Other' : undefined);
    if (!product) throw new BadRequestException(`product must be one of: ${PRODUCTS.join(', ')}.`);

    const existing = await this.prisma.mfgLead.findFirst({
      where: {
        orgId,
        OR: [
          ...(externalId ? [{ externalId }] : []),
          { isDeleted: false, phone: { endsWith: phone } },
          ...(email ? [{ isDeleted: false, email: { equals: email, mode: 'insensitive' as const } }] : []),
        ],
      },
      select: { id: true },
    });
    if (existing) return { duplicate: true, leadId: existing.id };

    const ownerId = await this.pickAssignee(orgId);
    try {
      const lead = await this.prisma.mfgLead.create({
        data: {
          orgId,
          externalId,
          contactName,
          company: company ?? contactName,
          phone,
          email,
          product,
          source: matchOption(SOURCES, payload.source) ?? 'Manual / API',
          requirement: payload.requirement,
          city: payload.city,
          state: payload.state,
          ownerId,
          status: ownerId ? 'Assigned' : 'New',
        },
      });
      await this.slaEngine.startTimer(orgId, MODULE_KEY, ENTITY_TYPE, lead.id, 'Lead created', lead.source, lead.value ?? undefined);
      return lead;
    } catch (err) {
      // Two requests with the same external id raced past the check above: the unique index decides.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && externalId) {
        const winner = await this.prisma.mfgLead.findFirst({ where: { orgId, externalId }, select: { id: true } });
        if (winner) return { duplicate: true, leadId: winner.id };
      }
      throw err;
    }
  }

  async update(id: string, dto: UpdateMfgLeadDto, caller: AuthUser) {
    await this.findOne(id, caller);
    if (dto.phone || dto.email) await this.assertNotDuplicate(dto, caller, id);
    return this.prisma.mfgLead.update({
      where: { id },
      data: { ...dto, ...(dto.nextDate ? { nextDate: new Date(dto.nextDate) } : {}) },
    });
  }

  async archive(id: string, caller: AuthUser): Promise<void> {
    await this.findOne(id, caller);
    await this.prisma.mfgLead.update({ where: { id }, data: { isDeleted: true } });
  }

  async performAction(id: string, action: string, payload: Record<string, unknown> | undefined, caller: AuthUser) {
    if (action === 'Convert to opportunity') return this.convert(id, payload, caller);
    if (action === 'Merge into another lead') return this.mergeInto(id, String(payload?.into ?? ''), caller);
    const record = await this.findOne(id, caller);
    const transition = PLAIN_TRANSITIONS[action];
    if (!transition) throw new BadRequestException(`Unknown action '${action}' for leads.`);
    if (!transition.when.includes(record.status)) {
      throw new BadRequestException(`Cannot ${action} a lead in status '${record.status}'.`);
    }
    if (transition.requires && !String(payload?.[transition.requires] ?? '').trim()) {
      throw new BadRequestException(`'${transition.requires}' is required to ${action}.`);
    }
    if (action === 'Qualify') {
      const missing = BANT_FIELDS.filter((f) => !record[f.key]).map((f) => f.label);
      if (missing.length) {
        throw new BadRequestException(`Capture ${missing.join(', ')} (Edit the lead, Qualification section) before qualifying it.`);
      }
    }
    const data: Prisma.MfgLeadUpdateInput = { status: transition.to };
    if (transition.requires === 'disq') data.disqualifyReason = payload![transition.requires] as string;
    const updated = await this.prisma.mfgLead.update({ where: { id }, data });

    if (action === 'Mark contacted') {
      // SLA-01 'Lead first response' stops here; SLA-02 'Lead qualification decision' starts.
      await this.slaEngine.stopTimer(updated.orgId, MODULE_KEY, ENTITY_TYPE, id, 'First call / message logged');
      await this.slaEngine.startTimer(updated.orgId, MODULE_KEY, ENTITY_TYPE, id, 'Lead contacted');
    } else if (['Qualify', 'Move to nurture', 'Disqualify'].includes(action)) {
      await this.slaEngine.stopTimer(updated.orgId, MODULE_KEY, ENTITY_TYPE, id, 'Qualified / Nurture / Disqualified');
    }
    if (action === 'Move to nurture') await this.nurturing.enroll(updated.orgId, 'mfg_lead_nurture', ENTITY_TYPE, id);

    return updated;
  }

  // Folds a duplicate lead into the one to keep: its history moves across, gaps on the kept lead are filled from it,
  // and it leaves the working list as 'Disqualified' (still findable under that filter, never erased).
  async mergeInto(id: string, keepId: string, caller: AuthUser) {
    if (!keepId) throw new BadRequestException(`'into' is required to merge a lead.`);
    if (keepId === id) throw new BadRequestException('Pick a different lead to merge into.');
    const [duplicate, keep] = await Promise.all([this.findOne(id, caller), this.findOne(keepId, caller)]);
    if (['Converted', 'Disqualified'].includes(duplicate.status) || keep.status === 'Disqualified') {
      throw new BadRequestException('Only open leads can be merged.');
    }
    const fill = Object.fromEntries(MERGEABLE_FIELDS.filter((field) => keep[field] == null && duplicate[field] != null).map((field) => [field, duplicate[field]]));
    const orgId = requireOrgId(caller);
    const [, kept] = await this.prisma.$transaction([
      this.prisma.mfgActivity.updateMany({ where: { mfgLeadId: id, orgId }, data: { mfgLeadId: keepId } }),
      this.prisma.mfgLead.update({ where: { id: keepId }, data: fill }),
      this.prisma.mfgLead.update({ where: { id }, data: { status: 'Disqualified', disqualifyReason: `Merged into ${keep.company} (LD-${keepId.replace(/-/g, '').slice(0, 6).toUpperCase()})` } }),
    ]);
    // The duplicate's timers and sequences stop with it.
    await this.slaEngine.stopTimer(orgId, MODULE_KEY, ENTITY_TYPE, id, 'Qualified / Nurture / Disqualified');
    await this.nurturing.endEnrollments(orgId, ENTITY_TYPE, id);
    return kept;
  }

  private normalizeCompanyName(name: string): string {
    return name
      .toLowerCase()
      .replace(/\b(pvt\.?\s*ltd\.?|private\s+limited|ltd\.?|limited|llp|inc\.?|corporation|corp\.?)\b/g, '')
      .replace(/[^a-z0-9]/g, '');
  }

  private async resolveAccount(
    lead: { company: string; city: string | null; state: string | null; ownerId: string | null },
    payload: Record<string, unknown> | undefined,
    caller: AuthUser,
  ): Promise<
    | { kind: 'existing'; accountId: string }
    | { kind: 'duplicate'; existingAccountId: string }
    | { kind: 'create'; data: Prisma.AccountUncheckedCreateInput }
  > {
    if (payload?.accountId) {
      const accountId = payload.accountId as string;
      const account = await this.prisma.account.findFirst({ where: { id: accountId, orgId: caller.orgId ?? '', isDeleted: false } });
      if (!account) throw new BadRequestException(`Account '${accountId}' not found in your organization.`);
      return { kind: 'existing', accountId };
    }
    const accountInput = payload?.account as
      | { type?: string; industry?: string; territory?: string; city?: string; state?: string; gstin?: string }
      | undefined;
    if (!accountInput?.type || !accountInput.industry || !accountInput.territory) {
      throw new BadRequestException(
        `'account.type', 'account.industry' and 'account.territory' are required to create a new account during conversion.`,
      );
    }
    const normalizedName = this.normalizeCompanyName(lead.company);
    const candidates = await this.prisma.account.findMany({ where: { orgId: caller.orgId ?? '', isDeleted: false } });
    const duplicate = candidates.find(
      (a) => this.normalizeCompanyName(a.name) === normalizedName || (accountInput.gstin && a.gstin?.trim().toUpperCase() === accountInput.gstin.trim().toUpperCase()),
    );
    if (duplicate) return { kind: 'duplicate', existingAccountId: duplicate.id };
    return {
      kind: 'create',
      data: {
        name: lead.company,
        short: lead.company,
        type: accountInput.type,
        industry: accountInput.industry,
        territory: accountInput.territory,
        city: accountInput.city ?? lead.city ?? 'Unknown',
        state: accountInput.state ?? lead.state ?? 'Unknown',
        gstin: accountInput.gstin,
        // The lead's owner carries over, so the rep who worked the lead can open the account (and its contacts) afterwards.
        ownerId: lead.ownerId ?? caller.id,
        orgId: requireOrgId(caller),
        status: 'Active',
      },
    };
  }

  async convert(id: string, payload: Record<string, unknown> | undefined, caller: AuthUser) {
    const lead = await this.findOne(id, caller);
    if (lead.status !== 'Qualified') {
      throw new BadRequestException(`Lead must be Qualified before it can be converted (current status: '${lead.status}').`);
    }
    if (!payload?.contactRole) throw new BadRequestException(`'contactRole' is required to convert a lead.`);
    const contactRole = payload.contactRole as string;

    const accountResolution = await this.resolveAccount(lead, payload, caller);
    if (accountResolution.kind === 'duplicate') {
      return { duplicate: true, existingAccountId: accountResolution.existingAccountId };
    }

    let linkContactId: string | undefined;
    if (payload?.contactId) {
      if (accountResolution.kind === 'create') {
        throw new BadRequestException(`'contactId' can only be used when converting onto an existing account.`);
      }
      const requestedContactId = payload.contactId as string;
      const contact = await this.prisma.contact.findFirst({
        where: { id: requestedContactId, accountId: accountResolution.accountId, orgId: caller.orgId ?? '', isDeleted: false },
      });
      if (!contact) throw new BadRequestException(`Contact '${requestedContactId}' not found on the target account.`);
      linkContactId = contact.id;
    } else if (accountResolution.kind === 'existing') {
      const existingContact = await this.prisma.contact.findFirst({
        where: {
          accountId: accountResolution.accountId,
          orgId: caller.orgId ?? '',
          isDeleted: false,
          OR: [{ phone: lead.phone }, ...(lead.email ? [{ email: lead.email }] : [])],
        },
      });
      if (existingContact) return { duplicate: true, existingContactId: existingContact.id };
    }

    return this.prisma.$transaction(async (tx) => {
      const accountId =
        accountResolution.kind === 'create' ? (await tx.account.create({ data: accountResolution.data })).id : accountResolution.accountId;

      const contactId =
        linkContactId ??
        (
          await tx.contact.create({
            data: {
              accountId,
              name: lead.contactName,
              phone: lead.phone,
              email: lead.email,
              designation: lead.designation,
              role: contactRole,
              status: 'Active',
              orgId: requireOrgId(caller),
            },
          })
        ).id;

      const opportunity = await tx.opportunity.create({
        data: {
          title: `${lead.company} — ${lead.product}`,
          accountId,
          contactId,
          product: lead.product,
          value: lead.value ?? 0,
          currency: 'INR',
          stage: 'Qualified',
          closeDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
          source: lead.source,
          ownerId: lead.ownerId ?? caller.id,
          nextAction: 'Follow up after conversion',
          nextActionDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          orgId: requireOrgId(caller),
        },
      });
      await tx.mfgLead.update({ where: { id }, data: { status: 'Converted' } });
      // The lead's calls and tasks follow it onto the account and opportunity, so history isn't lost at conversion.
      await tx.mfgActivity.updateMany({
        where: { mfgLeadId: id, orgId: lead.orgId, isDeleted: false },
        data: { opportunityId: opportunity.id, accountId, contactId },
      });
      return { accountId, contactId, opportunityId: opportunity.id };
    });
  }
}
