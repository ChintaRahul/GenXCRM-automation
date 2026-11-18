import { DocumentTemplatesAdapter } from './document-templates.adapter';
import { DocumentTemplatesService } from './document-templates.service';

describe('DocumentTemplatesAdapter', () => {
  it('registers under the docTemplates moduleKey', () => {
    const service = {} as DocumentTemplatesService;
    const registry = { register: jest.fn() };
    new DocumentTemplatesAdapter(service, registry as any);
    expect(registry.register).toHaveBeenCalledWith('docTemplates', expect.anything());
  });

  it('delegates list/create/update/archive to the service', async () => {
    const service = {
      findAll: jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 20, pages: 0 }),
      findOne: jest.fn(), create: jest.fn(), update: jest.fn(), archive: jest.fn(),
    } as any;
    const adapter = new DocumentTemplatesAdapter(service, { register: jest.fn() } as any);
    await adapter.list({ page: 1, limit: 20 } as any, {} as any);
    expect(service.findAll).toHaveBeenCalled();
    await adapter.create({ name: 'Quotation PDF', numberingPattern: 'QT-{YY}{MM}-{####}' }, {} as any);
    expect(service.create).toHaveBeenCalled();
    await adapter.update('dt-1', {}, {} as any);
    expect(service.update).toHaveBeenCalled();
    await adapter.archive('dt-1', {} as any);
    expect(service.archive).toHaveBeenCalled();
  });
});
