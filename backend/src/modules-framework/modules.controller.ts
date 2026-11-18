import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Res, UseGuards, NotFoundException, BadRequestException } from '@nestjs/common';
import type { Response } from 'express';
import { WorkspaceType } from '@prisma/client';
import { ModuleRegistryService } from './module-registry.service';
import { ModuleListQueryDto } from './dto/module-list-query.dto';
import { CreateSavedViewDto } from './dto/create-saved-view.dto';
import { SavedViewsService } from './saved-views/saved-views.service';
import { ColumnPrefsService } from './column-prefs/column-prefs.service';
import { ModuleAuditService } from './module-audit/module-audit.service';
import { ModuleDocumentsService } from './module-documents/module-documents.service';
import { InitModuleDocumentDto, SaveColumnPrefsDto } from './dto/module-record-extras.dto';
import { ModuleRelatedQueryDto } from './dto/module-related-query.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { WorkspaceGuard } from '../common/guards/workspace.guard';
import { RequireWorkspace } from '../common/decorators/require-workspace.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { assertModuleAccess, getModuleRights, getReadableModuleKeys } from './utils/record-access.util';
import { recordsToCsv } from './utils/csv.util';
import { buildIcs, CALENDAR_SOURCES } from './utils/ics.util';
import type { AuthUser } from '../common/types/auth-user.type';

// Cap on rows returned for a list export — generous enough for any real org's list, but bounded
// so an export request can't force an unbounded Prisma fetch.
const EXPORT_ROW_LIMIT = 5000;
const IMPORT_ROW_LIMIT = 500;
const GLOBAL_SEARCH_MODULES = ['leads', 'accounts', 'contacts', 'opps', 'quotes', 'pos', 'sorders', 'dispatch', 'assets'];

// Every manufacturing module — domain modules (leads, opps, ...) and Administration config
// modules (approvalRules, masters, ...) alike — registers through the same
// ModuleRegistryService and is dispatched from here, so this is the single place that
// enforces RolePermission's per-module CRUD matrix (assertModuleAccess), in addition to each
// adapter's own record-level scoping (resolveOwnerScope/canActAcrossOwners, applied inside
// the adapter/service itself).
@UseGuards(JwtAuthGuard, WorkspaceGuard)
@RequireWorkspace(WorkspaceType.MANUFACTURING)
@Controller('modules')
export class ModulesController {
  constructor(
    private readonly registry: ModuleRegistryService,
    private readonly prisma: PrismaService,
    private readonly savedViews: SavedViewsService,
    private readonly columnPrefs: ColumnPrefsService,
    private readonly audit: ModuleAuditService,
    private readonly documents: ModuleDocumentsService,
  ) {}

  // Declared first so "access" isn't read as a moduleKey.
  @Get('access')
  async access(@CurrentUser() user: AuthUser) {
    const [readable, rights] = await Promise.all([getReadableModuleKeys(this.prisma, user), getModuleRights(this.prisma, user)]);
    return { readable, rights };
  }

  // One box across the modules people look records up in (company, phone, email, GSTIN, serial, invoice no.).
  // Each module's own list applies the caller's access and ownership scoping, so nothing extra is exposed.
  @Get('search')
  async globalSearch(@Query('q') q: string | undefined, @CurrentUser() user: AuthUser) {
    const term = q?.trim();
    if (!term || term.length < 2) return [];
    const readable = new Set(await getReadableModuleKeys(this.prisma, user));
    // Displayed ids look like "QT-2CA9AF" (prefix + first 6 hex chars of the record id), so also search the hex part.
    const idPart = /^[a-z]{2,3}-([0-9a-f]{6})$/i.exec(term)?.[1];
    const terms = idPart ? [term, idPart] : [term];
    const groups = await Promise.all(
      GLOBAL_SEARCH_MODULES.filter((moduleKey) => readable.has(moduleKey)).map(async (moduleKey) => {
        const results = await Promise.all(terms.map((search) => this.registry.resolve(moduleKey).list({ search, page: 1, limit: 4 }, user)));
        const records = new Map(results.flatMap(({ data }) => data).map((record) => [String(record.id), record]));
        return [...records.values()].map((record) => ({ moduleKey, id: String(record.id), label: String(record.title ?? record.company ?? record.name ?? record.serial ?? record.invoiceNo ?? record.id) }));
      }),
    );
    return groups.flat();
  }

  @Get(':moduleKey')
  async list(@Param('moduleKey') moduleKey: string, @Query() query: ModuleListQueryDto, @CurrentUser() user: AuthUser) {
    await assertModuleAccess(this.prisma, user, moduleKey, 'read');
    return this.registry.resolve(moduleKey).list(query, user);
  }

  // List-level CSV export (the "Export" button on a module's list page) — generic across every
  // module, unlike the per-record getPdf/getCsv above, since it just dumps whatever fields the
  // list's own filters already return. Lives before ':moduleKey/:id' so "export" isn't swallowed
  // as a record id.
  @Get(':moduleKey/export')
  async exportList(
    @Param('moduleKey') moduleKey: string,
    @Query() query: ModuleListQueryDto,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    await assertModuleAccess(this.prisma, user, moduleKey, 'read');
    const { data } = await this.registry
      .resolve(moduleKey)
      .list({ ...query, page: 1, limit: EXPORT_ROW_LIMIT }, user);
    const csv = recordsToCsv(data);
    res.set({ 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="${moduleKey}.csv"` });
    res.send(csv);
  }

  // Live counts for the Filters drawer. Declared before ':moduleKey/:id' so "facets" isn't read
  // as a record id.
  @Get(':moduleKey/facets')
  async facets(@Param('moduleKey') moduleKey: string, @Query() query: ModuleListQueryDto, @CurrentUser() user: AuthUser) {
    await assertModuleAccess(this.prisma, user, moduleKey, 'read');
    const adapter = this.registry.resolve(moduleKey);
    if (!adapter.getFacets) throw new NotFoundException(`Module '${moduleKey}' has no filters.`);
    return adapter.getFacets(query, user);
  }

  // Per-user saved filter sets. Also before ':moduleKey/:id' for the same reason as "facets".
  @Get(':moduleKey/views')
  async listViews(@Param('moduleKey') moduleKey: string, @CurrentUser() user: AuthUser) {
    await assertModuleAccess(this.prisma, user, moduleKey, 'read');
    this.registry.resolve(moduleKey);
    return this.savedViews.list(moduleKey, user);
  }

  @Post(':moduleKey/views')
  async createView(@Param('moduleKey') moduleKey: string, @Body() dto: CreateSavedViewDto, @CurrentUser() user: AuthUser) {
    await assertModuleAccess(this.prisma, user, moduleKey, 'read');
    this.registry.resolve(moduleKey);
    return this.savedViews.create(moduleKey, dto, user);
  }

  @Delete(':moduleKey/views/:viewId')
  @HttpCode(204)
  async deleteView(@Param('moduleKey') moduleKey: string, @Param('viewId') viewId: string, @CurrentUser() user: AuthUser) {
    await this.savedViews.remove(moduleKey, viewId, user);
  }

  // Per-user list column choice. Declared before ':moduleKey/:id' so "column-prefs" isn't read as an id.
  @Get(':moduleKey/column-prefs')
  async getColumnPrefs(@Param('moduleKey') moduleKey: string, @CurrentUser() user: AuthUser) {
    await assertModuleAccess(this.prisma, user, moduleKey, 'read');
    this.registry.resolve(moduleKey);
    return this.columnPrefs.get(moduleKey, user);
  }

  @Put(':moduleKey/column-prefs')
  @HttpCode(204)
  async saveColumnPrefs(@Param('moduleKey') moduleKey: string, @Body() dto: SaveColumnPrefsDto, @CurrentUser() user: AuthUser) {
    await assertModuleAccess(this.prisma, user, moduleKey, 'read');
    this.registry.resolve(moduleKey);
    await this.columnPrefs.save(moduleKey, dto.keys, user);
  }

  @Get(':moduleKey/:id')
  async findOne(@Param('moduleKey') moduleKey: string, @Param('id') id: string, @CurrentUser() user: AuthUser) {
    await assertModuleAccess(this.prisma, user, moduleKey, 'read');
    return this.registry.resolve(moduleKey).findOne(id, user);
  }

  @Post(':moduleKey/import')
  async importRows(@Param('moduleKey') moduleKey: string, @Body() body: { rows?: Record<string, unknown>[] }, @CurrentUser() user: AuthUser) {
    await assertModuleAccess(this.prisma, user, moduleKey, 'create');
    const adapter = this.registry.resolve(moduleKey);
    if (!adapter.importRows) throw new NotFoundException(`Module '${moduleKey}' has no import.`);
    const rows = body.rows ?? [];
    if (!Array.isArray(rows) || rows.length === 0 || rows.length > IMPORT_ROW_LIMIT) {
      throw new BadRequestException(`Send between 1 and ${IMPORT_ROW_LIMIT} rows.`);
    }
    return adapter.importRows(rows, user);
  }

  @Post(':moduleKey')
  async create(@Param('moduleKey') moduleKey: string, @Body() dto: Record<string, unknown>, @CurrentUser() user: AuthUser) {
    await assertModuleAccess(this.prisma, user, moduleKey, 'create');
    return this.registry.resolve(moduleKey).create(dto, user);
  }

  @Patch(':moduleKey/:id')
  async update(
    @Param('moduleKey') moduleKey: string,
    @Param('id') id: string,
    @Body() dto: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ) {
    await assertModuleAccess(this.prisma, user, moduleKey, 'update');
    const adapter = this.registry.resolve(moduleKey);
    const before = await adapter.findOne(id, user);
    const updated = await adapter.update(id, dto, user);
    await this.audit.recordChanges(moduleKey, id, before, updated, user);
    return updated;
  }

  @Post(':moduleKey/:id/archive')
  async archive(@Param('moduleKey') moduleKey: string, @Param('id') id: string, @CurrentUser() user: AuthUser) {
    await assertModuleAccess(this.prisma, user, moduleKey, 'delete');
    return this.registry.resolve(moduleKey).archive(id, user);
  }

  @Post(':moduleKey/:id/actions')
  async performAction(
    @Param('moduleKey') moduleKey: string,
    @Param('id') id: string,
    @Body() body: { action: string } & Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ) {
    await assertModuleAccess(this.prisma, user, moduleKey, 'update');
    const adapter = this.registry.resolve(moduleKey);
    if (!adapter.performAction) throw new NotFoundException(`Actions are not available for module '${moduleKey}'.`);
    const { action, ...payload } = body;
    const before = await adapter.findOne(id, user);
    const result = await adapter.performAction(id, action, payload, user);
    if (result && typeof result === 'object') {
      await this.audit.recordChanges(moduleKey, id, before, result, user);
    }
    return result;
  }

  @Get(':moduleKey/:id/related/:tabKey')
  async getRelated(
    @Param('moduleKey') moduleKey: string,
    @Param('id') id: string,
    @Param('tabKey') tabKey: string,
    @Query() query: ModuleRelatedQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    await assertModuleAccess(this.prisma, user, moduleKey, 'read');
    const adapter = this.registry.resolve(moduleKey);
    if (!adapter.getRelated) throw new NotFoundException(`Related records are not available for module '${moduleKey}'.`);
    return adapter.getRelated(id, tabKey, { page: query.page ?? 1, limit: query.limit ?? 20 }, user);
  }

  @Post(':moduleKey/:id/table/:tabKey')
  async addTableRow(
    @Param('moduleKey') moduleKey: string,
    @Param('id') id: string,
    @Param('tabKey') tabKey: string,
    @Body() dto: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ) {
    await assertModuleAccess(this.prisma, user, moduleKey, 'update');
    const adapter = this.registry.resolve(moduleKey);
    if (!adapter.addTableRow) throw new NotFoundException(`Rows cannot be added to '${tabKey}' on module '${moduleKey}'.`);
    await adapter.addTableRow(id, tabKey, dto, user);
    return adapter.getTable ? adapter.getTable(id, tabKey, user) : undefined;
  }

  @Delete(':moduleKey/:id/table/:tabKey/:rowId')
  async removeTableRow(
    @Param('moduleKey') moduleKey: string,
    @Param('id') id: string,
    @Param('tabKey') tabKey: string,
    @Param('rowId') rowId: string,
    @CurrentUser() user: AuthUser,
  ) {
    await assertModuleAccess(this.prisma, user, moduleKey, 'update');
    const adapter = this.registry.resolve(moduleKey);
    if (!adapter.removeTableRow) throw new NotFoundException(`Rows cannot be removed from '${tabKey}' on module '${moduleKey}'.`);
    await adapter.removeTableRow(id, tabKey, rowId, user);
    return adapter.getTable ? adapter.getTable(id, tabKey, user) : undefined;
  }

  @Get(':moduleKey/:id/table/:tabKey')
  async getTable(
    @Param('moduleKey') moduleKey: string,
    @Param('id') id: string,
    @Param('tabKey') tabKey: string,
    @CurrentUser() user: AuthUser,
  ) {
    await assertModuleAccess(this.prisma, user, moduleKey, 'read');
    const adapter = this.registry.resolve(moduleKey);
    if (!adapter.getTable) throw new NotFoundException(`Table data is not available for module '${moduleKey}'.`);
    return adapter.getTable(id, tabKey, user);
  }

  @Get(':moduleKey/:id/events/:tabKey')
  async getEvents(
    @Param('moduleKey') moduleKey: string,
    @Param('id') id: string,
    @Param('tabKey') tabKey: string,
    @CurrentUser() user: AuthUser,
  ) {
    await assertModuleAccess(this.prisma, user, moduleKey, 'read');
    const adapter = this.registry.resolve(moduleKey);
    if (!adapter.getEvents) throw new NotFoundException(`Event data is not available for module '${moduleKey}'.`);
    return adapter.getEvents(id, tabKey, user);
  }

  @Get(':moduleKey/:id/audit')
  async getAudit(@Param('moduleKey') moduleKey: string, @Param('id') id: string, @CurrentUser() user: AuthUser) {
    await assertModuleAccess(this.prisma, user, moduleKey, 'read');
    await this.registry.resolve(moduleKey).findOne(id, user); // 404s when the record isn't visible to the caller
    return this.audit.list(moduleKey, id, user);
  }

  @Get(':moduleKey/:id/documents')
  async listDocuments(@Param('moduleKey') moduleKey: string, @Param('id') id: string, @CurrentUser() user: AuthUser) {
    await assertModuleAccess(this.prisma, user, moduleKey, 'read');
    await this.registry.resolve(moduleKey).findOne(id, user);
    return this.documents.list(moduleKey, id, user);
  }

  @Post(':moduleKey/:id/documents')
  async initDocument(
    @Param('moduleKey') moduleKey: string,
    @Param('id') id: string,
    @Body() dto: InitModuleDocumentDto,
    @CurrentUser() user: AuthUser,
  ) {
    await assertModuleAccess(this.prisma, user, moduleKey, 'update');
    await this.registry.resolve(moduleKey).findOne(id, user);
    return this.documents.init(moduleKey, id, dto, user);
  }

  @Post(':moduleKey/:id/documents/:documentId/complete')
  @HttpCode(204)
  async completeDocument(
    @Param('moduleKey') moduleKey: string,
    @Param('id') id: string,
    @Param('documentId') documentId: string,
    @CurrentUser() user: AuthUser,
  ) {
    await assertModuleAccess(this.prisma, user, moduleKey, 'update');
    await this.documents.complete(moduleKey, id, documentId, user);
  }

  @Delete(':moduleKey/:id/documents/:documentId')
  @HttpCode(204)
  async removeDocument(
    @Param('moduleKey') moduleKey: string,
    @Param('id') id: string,
    @Param('documentId') documentId: string,
    @CurrentUser() user: AuthUser,
  ) {
    await assertModuleAccess(this.prisma, user, moduleKey, 'update');
    await this.documents.remove(moduleKey, id, documentId, user);
  }

  @Get(':moduleKey/:id/pdf')
  async getPdf(
    @Param('moduleKey') moduleKey: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    await assertModuleAccess(this.prisma, user, moduleKey, 'read');
    const adapter = this.registry.resolve(moduleKey);
    if (!adapter.getPdf) throw new NotFoundException(`PDF export is not available for module '${moduleKey}'.`);
    const { filename, buffer } = await adapter.getPdf(id, user);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}"` });
    res.send(buffer);
  }

  // "Add to calendar": a one-event .ics for the records that have a date and time (tasks, visits, trials, tenders).
  @Get(':moduleKey/:id/calendar.ics')
  async getCalendarEvent(
    @Param('moduleKey') moduleKey: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    await assertModuleAccess(this.prisma, user, moduleKey, 'read');
    const toEvent = CALENDAR_SOURCES[moduleKey];
    if (!toEvent) throw new NotFoundException(`Calendar export is not available for module '${moduleKey}'.`);
    const event = toEvent((await this.registry.resolve(moduleKey).findOne(id, user)) as Record<string, unknown>);
    if (!event) throw new BadRequestException('This record has no date to put on a calendar.');
    res.set({ 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': `attachment; filename="${moduleKey}-${id}.ics"` });
    res.send(buildIcs({ uid: id, ...event }));
  }

  @Get(':moduleKey/:id/csv')
  async getCsv(
    @Param('moduleKey') moduleKey: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    await assertModuleAccess(this.prisma, user, moduleKey, 'read');
    const adapter = this.registry.resolve(moduleKey);
    if (!adapter.getCsv) throw new NotFoundException(`CSV export is not available for module '${moduleKey}'.`);
    const { filename, buffer } = await adapter.getCsv(id, user);
    res.set({ 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="${filename}"` });
    res.send(buffer);
  }
}
