import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types/auth-user.type';
import { canActAcrossOwners, resolveOwnerScope } from '../../modules-framework/utils/record-access.util';
import type { ModuleEventItem, ModuleListQuery, ModulePaginatedResult, ModuleTableResult } from '../../modules-framework/module-adapter.interface';
import { parseModuleSort } from '../../modules-framework/utils/module-sort.util';
import { requireOrgId } from '../../modules-framework/utils/require-org-id.util';
import { PdfService } from '../pdf/pdf.service';
import type { CreateReportDto } from './dto/create-report.dto';
import type { UpdateReportDto } from './dto/update-report.dto';
import { REPORT_BUILDERS } from './mfg-report-builders';

const SORTABLE_FIELDS = ['name', 'category', 'createdAt'];

@Injectable()
export class MfgReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: PdfService,
  ) {}

  private async scopeFilter(caller: AuthUser): Promise<Prisma.ReportWhereInput> {
    const orgFilter = caller.orgId ? { orgId: caller.orgId } : {};
    return { ...orgFilter, ...(await resolveOwnerScope(this.prisma, caller, 'reports')) };
  }

  async findAll(query: ModuleListQuery, caller: AuthUser): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { field, direction } = parseModuleSort(query.sort, SORTABLE_FIELDS, 'createdAt');
    const where: Prisma.ReportWhereInput = {
      ...(await this.scopeFilter(caller)),
      isDeleted: false,
      ...(query.status?.length ? { category: { in: query.status } } : {}),
      ...(query.ownerId?.length && (await canActAcrossOwners(this.prisma, caller, 'reports')) ? { ownerId: { in: query.ownerId } } : {}),
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
    };
    const [total, data] = await Promise.all([
      this.prisma.report.count({ where }),
      this.prisma.report.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { [field]: direction } }),
    ]);
    return { data, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async findOne(id: string, caller: AuthUser) {
    const record = await this.prisma.report.findFirst({ where: { id, ...(await this.scopeFilter(caller)), isDeleted: false } });
    if (!record) throw new NotFoundException(`Report '${id}' not found.`);
    return record;
  }

  async create(dto: CreateReportDto, caller: AuthUser) {
    const ownerId = (await canActAcrossOwners(this.prisma, caller, 'reports')) ? (dto.ownerId ?? caller.id) : caller.id;
    return this.prisma.report.create({
      data: {
        ...dto,
        ownerId,
        scheduleFrequency: dto.scheduleFrequency ?? 'Not scheduled',
        format: dto.format ?? 'Excel',
        orgId: requireOrgId(caller),
      },
    });
  }

  async update(id: string, dto: UpdateReportDto, caller: AuthUser) {
    await this.findOne(id, caller);
    return this.prisma.report.update({ where: { id }, data: dto });
  }

  async archive(id: string, caller: AuthUser): Promise<void> {
    await this.findOne(id, caller);
    await this.prisma.report.update({ where: { id }, data: { isDeleted: true } });
  }

  async performAction(
    id: string,
    action: string,
    payload: Record<string, unknown> | undefined,
    caller: AuthUser,
  ): Promise<Record<string, unknown>> {
    await this.findOne(id, caller);
    throw new BadRequestException(`Unknown action '${action}' for reports.`);
  }

  async getDataTable(id: string, caller: AuthUser): Promise<ModuleTableResult> {
    const record = await this.findOne(id, caller);
    const orgId = requireOrgId(caller);
    const builder = REPORT_BUILDERS[record.name];
    if (!builder) return this.notYetImplementedTable(record.name);
    return builder(this.prisma, orgId);
  }

  private notYetImplementedTable(name: string): ModuleTableResult {
    return {
      columns: [{ key: 'note', label: 'Note', type: 'text' }],
      rows: [{ note: `'${name}' data generation is not yet implemented.` }],
    };
  }

  private csvEscape(value: unknown): string {
    const s = String(value ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  async buildCsv(id: string, caller: AuthUser): Promise<{ filename: string; buffer: Buffer }> {
    const record = await this.findOne(id, caller);
    const table = await this.getDataTable(id, caller);
    await this.prisma.report.update({ where: { id }, data: { lastRunAt: new Date() } });
    const header = table.columns.map((c) => this.csvEscape(c.label)).join(',');
    const lines = table.rows.map((row) => table.columns.map((c) => this.csvEscape(row[c.key])).join(','));
    const buffer = Buffer.from([header, ...lines].join('\n'), 'utf8');
    return { filename: `${record.name.replace(/[^a-z0-9]+/gi, '-')}.csv`, buffer };
  }

  async buildPdf(id: string, caller: AuthUser): Promise<{ filename: string; buffer: Buffer }> {
    const record = await this.findOne(id, caller);
    const table = await this.getDataTable(id, caller);
    await this.prisma.report.update({ where: { id }, data: { lastRunAt: new Date() } });
    const buffer = await this.pdf.render((doc) => {
      doc.fontSize(16).font('Helvetica-Bold').text(record.name);
      doc.fontSize(9).font('Helvetica').text(new Date().toLocaleString('en-IN'));
      doc.moveDown();
      this.pdf.table(
        doc,
        table.columns.map((c) => ({ label: c.label })),
        table.rows.map((row) => table.columns.map((c) => String(row[c.key] ?? '—'))),
      );
    });
    return { filename: `${record.name.replace(/[^a-z0-9]+/gi, '-')}.pdf`, buffer };
  }

  async getScheduleEvents(id: string, caller: AuthUser): Promise<ModuleEventItem[]> {
    await this.findOne(id, caller);
    const rows = await this.prisma.reportSchedule.findMany({ where: { reportId: id }, orderBy: { ranAt: 'desc' } });
    return rows.map((row) => ({
      id: row.id,
      at: row.ranAt.toISOString(),
      label: row.status,
      description: row.recipientsSentTo ?? undefined,
    }));
  }
}
