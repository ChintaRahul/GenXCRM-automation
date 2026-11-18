import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ModulesController } from './modules.controller';
import { ModuleRegistryService } from './module-registry.service';
import { SavedViewsService } from './saved-views/saved-views.service';
import { ColumnPrefsService } from './column-prefs/column-prefs.service';
import { ModuleAuditService } from './module-audit/module-audit.service';
import { ModuleDocumentsService } from './module-documents/module-documents.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../common/types/auth-user.type';
import { Role } from '@prisma/client';

const caller: AuthUser = { id: 'u1', name: 'U', email: 'u@test.com', role: Role.SALES_REP, teamId: null, orgId: 'org-1' };

describe('ModulesController', () => {
  let controller: ModulesController;
  let registry: ModuleRegistryService;
  const rolePermissionFindFirst = jest.fn();
  const mockPrisma = { rolePermission: { findFirst: rolePermissionFindFirst } };
  const recordChanges = jest.fn();
  const mockAudit = { recordChanges, list: jest.fn() };
  const mockColumnPrefs = { get: jest.fn(), save: jest.fn() };
  const mockDocuments = { list: jest.fn(), init: jest.fn(), complete: jest.fn(), remove: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [ModulesController],
      providers: [
        ModuleRegistryService,
        SavedViewsService,
        { provide: ColumnPrefsService, useValue: mockColumnPrefs },
        { provide: ModuleAuditService, useValue: mockAudit },
        { provide: ModuleDocumentsService, useValue: mockDocuments },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    controller = module.get(ModulesController);
    registry = module.get(ModuleRegistryService);
  });

  it('delegates list() to the resolved adapter', async () => {
    const list = jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 20, pages: 0 });
    registry.register('accounts', { list, findOne: jest.fn(), create: jest.fn(), update: jest.fn(), archive: jest.fn() });
    await controller.list('accounts', { page: 1, limit: 20 }, caller);
    expect(list).toHaveBeenCalledWith({ page: 1, limit: 20 }, caller);
  });

  it('delegates facets() to the adapter and 404s when the module has no filters', async () => {
    const getFacets = jest.fn().mockResolvedValue({ total: 0 });
    registry.register('accounts', { list: jest.fn(), findOne: jest.fn(), create: jest.fn(), update: jest.fn(), archive: jest.fn(), getFacets });
    registry.register('masters', { list: jest.fn(), findOne: jest.fn(), create: jest.fn(), update: jest.fn(), archive: jest.fn() });
    await controller.facets('accounts', { page: 1, limit: 20, search: 'x' }, caller);
    expect(getFacets).toHaveBeenCalledWith({ page: 1, limit: 20, search: 'x' }, caller);
    await expect(controller.facets('masters', { page: 1, limit: 20 }, caller)).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException for an unregistered moduleKey', async () => {
    await expect(controller.list('rfqs', { page: 1, limit: 20 }, caller)).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException when performAction is called on an adapter that does not implement it', async () => {
    registry.register('contacts', { list: jest.fn(), findOne: jest.fn(), create: jest.fn(), update: jest.fn(), archive: jest.fn() });
    await expect(controller.performAction('contacts', 'C-1', { action: 'Anything' }, caller)).rejects.toThrow(NotFoundException);
  });

  describe('getPdf / getCsv', () => {
    const mockRes = () => ({ set: jest.fn(), send: jest.fn() }) as unknown as import('express').Response;

    it('streams the adapter\'s PDF buffer with the right content-type and filename', async () => {
      const getPdf = jest.fn().mockResolvedValue({ filename: 'Quotation-q1.pdf', buffer: Buffer.from('pdf') });
      registry.register('quotes', { list: jest.fn(), findOne: jest.fn(), create: jest.fn(), update: jest.fn(), archive: jest.fn(), getPdf });
      const res = mockRes();
      await controller.getPdf('quotes', 'q1', caller, res);
      expect(getPdf).toHaveBeenCalledWith('q1', caller);
      expect(res.set).toHaveBeenCalledWith(
        expect.objectContaining({ 'Content-Type': 'application/pdf', 'Content-Disposition': expect.stringContaining('Quotation-q1.pdf') }),
      );
      expect(res.send).toHaveBeenCalledWith(Buffer.from('pdf'));
    });

    it('throws NotFoundException when the adapter has no getPdf', async () => {
      registry.register('contacts', { list: jest.fn(), findOne: jest.fn(), create: jest.fn(), update: jest.fn(), archive: jest.fn() });
      await expect(controller.getPdf('contacts', 'C-1', caller, mockRes())).rejects.toThrow(NotFoundException);
    });

    it('streams the adapter\'s CSV buffer with the right content-type', async () => {
      const getCsv = jest.fn().mockResolvedValue({ filename: 'Report.csv', buffer: Buffer.from('a,b') });
      registry.register('reports', { list: jest.fn(), findOne: jest.fn(), create: jest.fn(), update: jest.fn(), archive: jest.fn(), getCsv });
      const res = mockRes();
      await controller.getCsv('reports', 'r1', caller, res);
      expect(res.set).toHaveBeenCalledWith(expect.objectContaining({ 'Content-Type': 'text/csv' }));
      expect(res.send).toHaveBeenCalledWith(Buffer.from('a,b'));
    });

    it('throws NotFoundException when the adapter has no getCsv', async () => {
      registry.register('contacts', { list: jest.fn(), findOne: jest.fn(), create: jest.fn(), update: jest.fn(), archive: jest.fn() });
      await expect(controller.getCsv('contacts', 'C-1', caller, mockRes())).rejects.toThrow(NotFoundException);
    });
  });

  describe('exportList', () => {
    const mockRes = () => ({ set: jest.fn(), send: jest.fn() }) as unknown as import('express').Response;

    it('builds a CSV from the adapter\'s list() data, ignoring pagination from the request', async () => {
      const list = jest.fn().mockResolvedValue({
        data: [{ id: 'A-1', short: 'Kaveri Steel' }, { id: 'A-2', short: 'Shivalik Mills' }],
        total: 2, page: 1, limit: 20, pages: 1,
      });
      registry.register('accounts', { list, findOne: jest.fn(), create: jest.fn(), update: jest.fn(), archive: jest.fn() });
      const res = mockRes();
      await controller.exportList('accounts', { page: 3, limit: 20 }, caller, res);
      expect(list).toHaveBeenCalledWith({ page: 1, limit: 5000 }, caller);
      expect(res.set).toHaveBeenCalledWith(
        expect.objectContaining({ 'Content-Type': 'text/csv', 'Content-Disposition': expect.stringContaining('accounts.csv') }),
      );
      expect(res.send).toHaveBeenCalledWith('id,short\nA-1,Kaveri Steel\nA-2,Shivalik Mills');
    });

    it('sends an empty CSV body when the list has no rows', async () => {
      const list = jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 20, pages: 0 });
      registry.register('accounts', { list, findOne: jest.fn(), create: jest.fn(), update: jest.fn(), archive: jest.fn() });
      const res = mockRes();
      await controller.exportList('accounts', { page: 1, limit: 20 }, caller, res);
      expect(res.send).toHaveBeenCalledWith('');
    });

    it('throws NotFoundException for an unregistered moduleKey', async () => {
      await expect(controller.exportList('rfqs', { page: 1, limit: 20 }, caller, mockRes())).rejects.toThrow(NotFoundException);
    });
  });

  describe('RolePermission CRUD-matrix enforcement (assertModuleAccess)', () => {
    const mfgCaller: AuthUser = { ...caller, mfgRole: 'SERVICE_ENGINEER' };

    it('does not consult RolePermission for a caller with no mfgRole (legacy fallback)', async () => {
      const list = jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 20, pages: 0 });
      registry.register('accounts', { list, findOne: jest.fn(), create: jest.fn(), update: jest.fn(), archive: jest.fn() });
      await controller.list('accounts', { page: 1, limit: 20 }, caller);
      expect(rolePermissionFindFirst).not.toHaveBeenCalled();
    });

    it('rejects create() with ForbiddenException when the caller lacks canCreate', async () => {
      rolePermissionFindFirst.mockResolvedValue({ canCreate: false, canRead: true, canUpdate: false, canDelete: false });
      const create = jest.fn();
      registry.register('costing', { list: jest.fn(), findOne: jest.fn(), create, update: jest.fn(), archive: jest.fn() });
      await expect(controller.create('costing', {}, mfgCaller)).rejects.toThrow(ForbiddenException);
      expect(create).not.toHaveBeenCalled();
    });

    it('rejects archive() with ForbiddenException when the caller lacks canDelete', async () => {
      rolePermissionFindFirst.mockResolvedValue({ canCreate: true, canRead: true, canUpdate: true, canDelete: false });
      const archive = jest.fn();
      registry.register('costing', { list: jest.fn(), findOne: jest.fn(), create: jest.fn(), update: jest.fn(), archive });
      await expect(controller.archive('costing', 'CS-1', mfgCaller)).rejects.toThrow(ForbiddenException);
      expect(archive).not.toHaveBeenCalled();
    });

    it('rejects performAction() with ForbiddenException when the caller lacks canUpdate', async () => {
      rolePermissionFindFirst.mockResolvedValue({ canCreate: true, canRead: true, canUpdate: false, canDelete: true });
      const performAction = jest.fn();
      registry.register('costing', { list: jest.fn(), findOne: jest.fn(), create: jest.fn(), update: jest.fn(), archive: jest.fn(), performAction });
      await expect(controller.performAction('costing', 'CS-1', { action: 'Submit' }, mfgCaller)).rejects.toThrow(ForbiddenException);
      expect(performAction).not.toHaveBeenCalled();
    });

    it('allows the call through when the RolePermission row grants the operation', async () => {
      rolePermissionFindFirst.mockResolvedValue({ canCreate: true, canRead: true, canUpdate: true, canDelete: true });
      const create = jest.fn().mockResolvedValue({ id: 'CS-1' });
      registry.register('costing', { list: jest.fn(), findOne: jest.fn(), create, update: jest.fn(), archive: jest.fn() });
      await controller.create('costing', { opportunityId: 'OP-1' }, mfgCaller);
      expect(create).toHaveBeenCalledWith({ opportunityId: 'OP-1' }, mfgCaller);
    });
  });

  describe('record history, documents and column prefs', () => {
    const adapter = (over: Record<string, unknown> = {}) => ({
      list: jest.fn(),
      findOne: jest.fn().mockResolvedValue({ id: 'A-1', name: 'Old' }),
      create: jest.fn(),
      update: jest.fn().mockResolvedValue({ id: 'A-1', name: 'New' }),
      archive: jest.fn(),
      ...over,
    });

    it('records an audit diff (before vs after) when a record is updated', async () => {
      registry.register('accounts', adapter());
      const result = await controller.update('accounts', 'A-1', { name: 'New' }, caller);
      expect(result).toEqual({ id: 'A-1', name: 'New' });
      expect(recordChanges).toHaveBeenCalledWith('accounts', 'A-1', { id: 'A-1', name: 'Old' }, { id: 'A-1', name: 'New' }, caller);
    });

    it('records an audit diff for an action that returns the updated record', async () => {
      registry.register('opps', adapter({ performAction: jest.fn().mockResolvedValue({ id: 'A-1', name: 'Won' }) }));
      await controller.performAction('opps', 'A-1', { action: 'Mark won' }, caller);
      expect(recordChanges).toHaveBeenCalledWith('opps', 'A-1', { id: 'A-1', name: 'Old' }, { id: 'A-1', name: 'Won' }, caller);
    });

    it('serves the audit trail only after the record is confirmed visible to the caller', async () => {
      const findOne = jest.fn().mockRejectedValue(new NotFoundException('nope'));
      registry.register('accounts', adapter({ findOne }));
      await expect(controller.getAudit('accounts', 'A-9', caller)).rejects.toThrow(NotFoundException);
      expect(mockAudit.list).not.toHaveBeenCalled();
    });

    it('lists documents and column prefs through the services with the caller', async () => {
      registry.register('accounts', adapter());
      await controller.listDocuments('accounts', 'A-1', caller);
      expect(mockDocuments.list).toHaveBeenCalledWith('accounts', 'A-1', caller);
      await controller.getColumnPrefs('accounts', caller);
      expect(mockColumnPrefs.get).toHaveBeenCalledWith('accounts', caller);
      await controller.saveColumnPrefs('accounts', { keys: ['name'] }, caller);
      expect(mockColumnPrefs.save).toHaveBeenCalledWith('accounts', ['name'], caller);
    });

    it('requires update access to upload or delete a document', async () => {
      const mfgCaller = { ...caller, mfgRole: 'SALES_EXECUTIVE' } as AuthUser;
      rolePermissionFindFirst.mockResolvedValue({ canRead: true, canUpdate: false });
      registry.register('accounts', adapter());
      await expect(
        controller.initDocument('accounts', 'A-1', { fileName: 'a.pdf', mimeType: 'application/pdf', fileSize: 10 }, mfgCaller),
      ).rejects.toThrow(ForbiddenException);
      await expect(controller.removeDocument('accounts', 'A-1', 'd1', mfgCaller)).rejects.toThrow(ForbiddenException);
      expect(mockDocuments.init).not.toHaveBeenCalled();
      expect(mockDocuments.remove).not.toHaveBeenCalled();
    });
  });
});
