import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreateSequenceDto } from './dto/create-sequence.dto';
import type { UpdateSequenceDto } from './dto/update-sequence.dto';
import type { CreateStepDto } from './dto/create-step.dto';
import { TrialService } from '../trial/trial.service';
import { CommunicationsService } from '../communications/communications.service';
import { WELCOME_SEQUENCE_TRIGGER, welcomeSequenceCreateData } from './welcome-sequence';
import type { AuthUser } from '../../common/types/auth-user.type';
import { ErrorMessages } from '../../common/constants/messages';
import { buildLeadScopeFilter } from '../../common/utils/scope.util';

// System actor for engine-initiated sends. CommunicationsService only reads
// `caller.id` (recorded as metadata.sentBy), so a sentinel is sufficient.
const NURTURING_ACTOR: AuthUser = {
  id: 'nurturing-engine',
  name: 'Nurturing Engine',
  email: '',
  role: Role.DIRECTOR,
  mfgRole: null,
  teamId: null,
  orgId: null,
};

// Max sequences (active or not) an org can create.
const MAX_SEQUENCES_PER_ORG = 50;

// Enrollment + the lead fields step content is interpolated from — shared by the tick and
// the immediate run so both send identical content.
const ENROLLMENT_INCLUDE = {
  sequence: { include: { steps: { orderBy: { stepOrder: 'asc' } } } },
  lead: {
    select: {
      name: true,
      course: true,
      email: true,
      phone: true,
      org: { select: { name: true } },
      assignedTo: { select: { name: true } },
      payments: { orderBy: { createdAt: 'desc' }, take: 1, select: { amount: true, paymentLink: true } },
    },
  },
} satisfies Prisma.NurturingEnrollmentInclude;

// While an enrollment is being run immediately, its nextRunAt is pushed this far out so the
// periodic tick can't pick it up too (no double send). If the immediate run dies, the tick
// takes over once the lease expires.
const IMMEDIATE_LEASE_MS = 60_000;

const DAY_MS = 24 * 60 * 60 * 1000;
const addDays = (from: Date, days: number): Date => new Date(from.getTime() + days * DAY_MS);

// Lead fields available for {{placeholder}} interpolation in step content.
type NurturingLead = {
  name: string | null;
  course: string | null;
  email: string | null;
  phone: string | null;
  org?: { name: string | null } | null;
  assignedTo?: { name: string | null } | null;
  // Most recent payment only (query orders by createdAt desc, take 1) — {{amount}}/{{payment_link}}
  // resolve from index 0.
  payments?: { amount: number; paymentLink: string | null }[];
};

@Injectable()
export class NurturingService {
  private readonly logger = new Logger(NurturingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly trial: TrialService,
    private readonly comms: CommunicationsService,
  ) {}

  findAll(caller: AuthUser) {
    return this.prisma.nurturingSequence.findMany({
      where: { ...(caller.orgId && { orgId: caller.orgId }) },
      orderBy: { createdAt: 'desc' },
      // Excludes 'removed' enrollments — same filter as findOne()/getEnrollments() —
      // otherwise this count includes soft-removed rows the enrollment list never shows.
      include: { _count: { select: { steps: true, enrollments: { where: { status: { not: 'removed' } } } } } },
    });
  }

  // Steps + a cheap enrollment count only — the enrollment list itself can run into
  // tens of thousands of rows for a busy welcome sequence, so it's fetched separately
  // (paginated) via getEnrollments() rather than embedded here.
  async findOne(id: string, caller?: AuthUser) {
    const seq = await this.prisma.nurturingSequence.findFirst({
      where: { id, ...(caller?.orgId && { orgId: caller.orgId }) },
      include: {
        steps: { orderBy: { stepOrder: 'asc' } },
        _count: { select: { enrollments: { where: { status: { not: 'removed' } } } } },
      },
    });
    if (!seq) throw new NotFoundException(ErrorMessages.nurturing.sequenceNotFound);
    return seq;
  }

  async getEnrollments(sequenceId: string, caller: AuthUser, page = 1, limit = 20) {
    const seq = await this.prisma.nurturingSequence.findFirst({
      where: { id: sequenceId, ...(caller.orgId && { orgId: caller.orgId }) },
      select: { id: true },
    });
    if (!seq) throw new NotFoundException(ErrorMessages.nurturing.sequenceNotFound);

    const where: Prisma.NurturingEnrollmentWhereInput = {
      sequenceId,
      status: { not: 'removed' },
      lead: buildLeadScopeFilter(caller),
    };
    const [data, total] = await Promise.all([
      this.prisma.nurturingEnrollment.findMany({
        where,
        orderBy: { enrolledAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { lead: { select: { id: true, name: true, email: true, stage: true } } },
      }),
      this.prisma.nurturingEnrollment.count({ where }),
    ]);
    return { data, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async create(dto: CreateSequenceDto, caller: AuthUser) {
    // Creating is capped per org; the plan's sequence limit only applies to ACTIVE ones
    // (enforced in update() when a sequence is switched on).
    if (caller.orgId) {
      const total = await this.prisma.nurturingSequence.count({ where: { orgId: caller.orgId } });
      if (total >= MAX_SEQUENCES_PER_ORG) {
        throw new ForbiddenException({
          code: 'SEQUENCE_CAP_REACHED',
          resource: 'sequences',
          limit: MAX_SEQUENCES_PER_ORG,
          current: total,
          message: ErrorMessages.nurturing.sequenceCapReached(MAX_SEQUENCES_PER_ORG),
        });
      }
    }
    return this.prisma.nurturingSequence.create({
      data: {
        name: dto.name,
        description: dto.description,
        triggerEvent: dto.triggerEvent ?? 'manual',
        triggerStage: dto.triggerStage,
        orgId: caller.orgId ?? undefined,
      },
    });
  }

  async update(id: string, dto: UpdateSequenceDto, caller: AuthUser) {
    const existing = await this.findOne(id, caller);
    if (dto.isActive && !existing.isActive) {
      await this.trial.checkLimit(caller.orgId, 'sequences');
    }
    return this.prisma.nurturingSequence.update({ where: { id }, data: dto });
  }

  async remove(id: string, caller: AuthUser) {
    await this.findOne(id, caller);
    return this.prisma.nurturingSequence.delete({ where: { id } });
  }

  async addStep(sequenceId: string, dto: CreateStepDto, caller: AuthUser) {
    await this.findOne(sequenceId, caller);
    if (dto.type === 'whatsapp') {
      await this.assertApprovedWhatsapp(dto.templateName, caller);
    }
    if (dto.attachmentIds?.length) {
      await this.comms.resolveAttachments(dto.attachmentIds, caller);
    }
    return this.prisma.nurturingStep.create({
      data: {
        sequenceId,
        stepOrder: dto.stepOrder,
        type: dto.type,
        subject: dto.subject,
        body: dto.body,
        delayDays: dto.delayDays ?? 0,
        templateName: dto.templateName,
        templateLang: dto.templateLang,
        templateParams: dto.templateParams,
        attachmentIds: dto.attachmentIds,
      },
    });
  }

  async updateStep(stepId: string, dto: Partial<CreateStepDto>, caller: AuthUser) {
    const step = await this.prisma.nurturingStep.findUnique({ where: { id: stepId } });
    if (!step) throw new NotFoundException(ErrorMessages.nurturing.stepNotFound);
    const effectiveType = dto.type ?? step.type;
    if (effectiveType === 'whatsapp') {
      const templateName = dto.templateName !== undefined ? dto.templateName : step.templateName ?? undefined;
      await this.assertApprovedWhatsapp(templateName, caller);
    }
    if (dto.attachmentIds?.length) {
      await this.comms.resolveAttachments(dto.attachmentIds, caller);
    }
    return this.prisma.nurturingStep.update({ where: { id: stepId }, data: dto });
  }

  // WhatsApp nurturing may only use an APPROVED Meta template (visible to the caller's org or a
  // system default). Guards both add and update paths.
  private async assertApprovedWhatsapp(templateName: string | undefined, caller: AuthUser) {
    if (templateName) {
      const approved = await this.prisma.messageTemplate.findFirst({
        where: {
          channel: 'WHATSAPP',
          status: 'APPROVED',
          metaTemplateName: templateName,
          OR: [{ isSystem: true }, { orgId: caller.orgId ?? undefined }],
        },
      });
      if (approved) return;
    }
    throw new BadRequestException(ErrorMessages.templates.whatsappNeedsApproved);
  }

  async removeStep(stepId: string) {
    const step = await this.prisma.nurturingStep.findUnique({ where: { id: stepId } });
    if (!step) throw new NotFoundException(ErrorMessages.nurturing.stepNotFound);
    return this.prisma.nurturingStep.delete({ where: { id: stepId } });
  }

  async enrollLead(sequenceId: string, leadId: string, caller: AuthUser) {
    await this.findOne(sequenceId, caller);

    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, ...buildLeadScopeFilter(caller) },
      select: { id: true },
    });
    if (!lead) throw new NotFoundException(ErrorMessages.leads.notFound);

    const existing = await this.prisma.nurturingEnrollment.findUnique({
      where: { sequenceId_leadId: { sequenceId, leadId } },
    });
    if (existing && existing.status !== 'removed') {
      throw new ConflictException(ErrorMessages.nurturing.alreadyEnrolled);
    }

    return this.startEnrollment(sequenceId, leadId, existing?.id);
  }

  // Creates or reactivates an enrollment and schedules its first step. The first
  // step's `delayDays` is the wait before it runs; `nextRunAt = now + delayDays`
  // (delayDays 0 → due on the next tick). A sequence with no steps completes at once.
  // With `immediate`, a delay-0 first step is leased (see IMMEDIATE_LEASE_MS) so the caller
  // can run it right away instead of waiting for the next tick.
  private async startEnrollment(sequenceId: string, leadId: string, existingId?: string, immediate = false) {
    const firstStep = await this.prisma.nurturingStep.findFirst({
      where: { sequenceId },
      orderBy: { stepOrder: 'asc' },
    });

    const now = new Date();
    const nextRunAt =
      immediate && firstStep?.delayDays === 0
        ? new Date(now.getTime() + IMMEDIATE_LEASE_MS)
        : addDays(now, firstStep?.delayDays ?? 0);
    const data = firstStep
      ? { status: 'active', currentStep: 0, nextRunAt, completedAt: null }
      : { status: 'completed', currentStep: 0, nextRunAt: null, completedAt: now };

    if (existingId) {
      return this.prisma.nurturingEnrollment.update({
        where: { id: existingId },
        data: { ...data, enrolledAt: now },
      });
    }

    return this.prisma.nurturingEnrollment.create({
      data: { sequenceId, leadId, ...data },
    });
  }

  // Trigger-driven enrollment (system-initiated, no caller). Enrolls the lead into
  // every active sequence in its org whose triggerEvent matches. Skips sequences the
  // lead is already actively enrolled in. Best-effort: failures are logged, not thrown.
  // By default a delay-0 first step (and any delay-0 steps after it) is sent right away;
  // pass `immediate = false` for bulk paths (CSV import) so sends are spread across ticks
  // instead of bursting.
  async autoEnroll(leadId: string, orgId: string | null, trigger: string, stage?: string, immediate = true) {
    const sequences = await this.prisma.nurturingSequence.findMany({
      where: {
        isActive: true,
        triggerEvent: trigger,
        ...(stage ? { OR: [{ triggerStage: null }, { triggerStage: stage }] } : {}),
        ...(orgId ? { orgId } : { orgId: null }),
      },
      select: { id: true },
    });

    for (const { id: sequenceId } of sequences) {
      try {
        const existing = await this.prisma.nurturingEnrollment.findUnique({
          where: { sequenceId_leadId: { sequenceId, leadId } },
        });
        if (existing && existing.status !== 'removed') continue;
        const enrollment = await this.startEnrollment(sequenceId, leadId, existing?.id, immediate);
        if (immediate && enrollment?.id) await this.runImmediately(enrollment.id);
      } catch (err) {
        this.logger.error(
          `Auto-enroll failed for lead ${leadId} into sequence ${sequenceId}`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  }

  // Runs an enrollment's leading delay-0 steps in one go (e.g. WhatsApp then email), stopping
  // at the first step that has a delay. Failures are logged and left to the tick to retry once
  // the lease expires — never thrown, so a send problem can't affect the triggering action.
  private async runImmediately(enrollmentId: string) {
    try {
      const enrollment = await this.prisma.nurturingEnrollment.findUnique({
        where: { id: enrollmentId },
        include: ENROLLMENT_INCLUDE,
      });
      if (enrollment?.status !== 'active' || !enrollment.sequence.isActive) return;

      let current = enrollment;
      for (let i = current.currentStep; i < current.sequence.steps.length; i++) {
        const runNext = await this.runStep(current, true);
        if (!runNext) break;
        current = { ...current, currentStep: current.currentStep + 1 };
      }
    } catch (err) {
      this.logger.error(
        `Immediate nurturing run failed for enrollment ${enrollmentId}`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // Provisions an org's default "Welcome New Leads" sequence: a single email step that
  // fires on lead creation. Idempotent — does nothing if the org already has any
  // lead_created sequence. Called on org creation so new leads are welcomed out of the box.
  async createDefaultWelcomeSequence(orgId: string) {
    const existing = await this.prisma.nurturingSequence.findFirst({
      where: { orgId, triggerEvent: WELCOME_SEQUENCE_TRIGGER },
      select: { id: true },
    });
    if (existing) return existing;

    return this.prisma.nurturingSequence.create({ data: welcomeSequenceCreateData(orgId) });
  }

  // Engine tick: advances up to NURTURING_BATCH_SIZE active, due enrollments by one step
  // (oldest-due first). Sends the step's message via CommunicationsService, then schedules
  // the next step or completes. Each enrollment is isolated so one failure does not stall
  // the batch. The cap keeps a burst of due sends (e.g. a large CSV import that enrolls
  // thousands of leads in a `lead_created` sequence at once) spread across ticks instead of
  // firing every send in a single unthrottled batch — leftover enrollments stay due and are
  // picked up on the next tick.
  async executeDueEnrollments() {
    const batchSize = Number(process.env.NURTURING_BATCH_SIZE) || 200;
    const due = await this.prisma.nurturingEnrollment.findMany({
      where: { status: 'active', nextRunAt: { lte: new Date() }, sequence: { isActive: true } },
      orderBy: { nextRunAt: 'asc' },
      take: batchSize,
      include: ENROLLMENT_INCLUDE,
    });

    for (const enrollment of due) {
      try {
        await this.runStep(enrollment);
      } catch (err) {
        this.logger.error(
          `Nurturing step failed for enrollment ${enrollment.id}`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    return { processed: due.length };
  }

  // Replaces {{name}}, {{course}}, {{email}}, {{phone}}, {{org}}, {{rep}}, {{plan}}, {{amount}},
  // {{payment_link}} placeholders with the lead's values — {{org}} is the lead's organization
  // name, {{rep}} the assigned sales rep, {{plan}} the lead's course (stands in for a selected
  // plan), {{amount}}/{{payment_link}} the lead's most recent payment. Missing → empty string,
  // so step content still reads naturally per lead.
  private interpolate(template: string, lead: NurturingLead | null): string {
    const latestPayment = lead?.payments?.[0];
    const values: Record<string, string> = {
      name: lead?.name ?? '',
      course: lead?.course ?? '',
      email: lead?.email ?? '',
      phone: lead?.phone ?? '',
      org: lead?.org?.name ?? '',
      rep: lead?.assignedTo?.name ?? '',
      plan: lead?.course ?? '',
      amount: latestPayment ? String(latestPayment.amount) : '',
      payment_link: latestPayment?.paymentLink ?? '',
    };
    return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => values[key] ?? '');
  }

  private async runStep(
    enrollment: {
      id: string;
      leadId: string;
      currentStep: number;
      lead?: NurturingLead | null;
      sequence: {
        steps: {
          type: string;
          subject: string | null;
          body: string | null;
          delayDays: number;
          templateName?: string | null;
          templateLang?: string | null;
          templateParams?: Prisma.JsonValue;
          attachmentIds?: Prisma.JsonValue;
        }[];
      };
    },
    // Chaining (immediate run): when the next step also has delay 0, lease it instead of
    // leaving it due, and return true so the caller runs it now. Returns false otherwise.
    chain = false,
  ): Promise<boolean> {
    const { steps } = enrollment.sequence;
    const step = steps[enrollment.currentStep];

    if (step) {
      const { leadId, lead } = enrollment;
      const body = this.interpolate(step.body ?? '', lead ?? null);
      const subject = this.interpolate(step.subject ?? '', lead ?? null);
      try {
        switch (step.type) {
          case 'email': {
            const attachmentIds = Array.isArray(step.attachmentIds) ? (step.attachmentIds as string[]) : undefined;
            await this.comms.sendEmail(leadId, subject, body, NURTURING_ACTOR, lead?.org?.name ?? undefined, attachmentIds);
            break;
          }
          case 'sms':
            await this.comms.sendSms(leadId, body, NURTURING_ACTOR);
            break;
          case 'whatsapp':
            // A template (sendable any time) when one is configured; otherwise free-form text, which
            // Meta only delivers inside the lead's 24h reply window.
            if (step.templateName) {
              const params = (Array.isArray(step.templateParams) ? step.templateParams : []).map((p) =>
                this.interpolate(String(p ?? ''), lead ?? null),
              );
              await this.comms.sendWhatsAppTemplate(
                leadId,
                step.templateName,
                step.templateLang ?? 'en_US',
                params,
                NURTURING_ACTOR,
              );
            } else {
              await this.comms.sendWhatsApp(leadId, body, NURTURING_ACTOR);
            }
            break;
          case 'wait':
          default:
            break; // wait/unknown steps only delay
        }
      } catch (err) {
        // Caught here, not left to propagate: a permanently unsendable step (e.g. no phone
        // number on file) must not block the enrollment forever. Before this, a thrown send
        // error skipped the currentStep/nextRunAt update below, so the same due enrollment
        // was picked up again on the very next tick — retrying, and failing, identically,
        // every tick forever, with no way to ever advance or complete.
        this.logger.error(
          `Nurturing step send failed for enrollment ${enrollment.id} (step ${enrollment.currentStep}, type ${step.type}) — advancing anyway`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    const nextIndex = enrollment.currentStep + 1;
    const nextStep = steps[nextIndex];
    const now = new Date();

    const runNext = chain && nextStep?.delayDays === 0;
    await this.prisma.nurturingEnrollment.update({
      where: { id: enrollment.id },
      data: nextStep
        ? {
            currentStep: nextIndex,
            nextRunAt: runNext ? new Date(now.getTime() + IMMEDIATE_LEASE_MS) : addDays(now, nextStep.delayDays),
          }
        : { currentStep: nextIndex, status: 'completed', completedAt: now, nextRunAt: null },
    });
    return runNext;
  }

  async removeEnrollment(enrollmentId: string, caller: AuthUser) {
    const enrollment = await this.prisma.nurturingEnrollment.findFirst({
      where: { id: enrollmentId, lead: buildLeadScopeFilter(caller) },
    });
    if (!enrollment) throw new NotFoundException(ErrorMessages.nurturing.enrollmentNotFound);
    return this.prisma.nurturingEnrollment.update({
      where: { id: enrollmentId },
      data: { status: 'removed' },
    });
  }
}
