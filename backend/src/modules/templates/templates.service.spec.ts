import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import { Role, TemplateChannel, IntegrationProvider, IntegrationStatus } from '@prisma/client';
import { TemplatesService } from './templates.service';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsappTemplatesApi } from '../../integrations/whatsapp/whatsapp-templates.api';
import type { AuthUser } from '../../common/types/auth-user.type';

jest.mock('../../common/crypto.utils', () => ({
  encryptToken: jest.fn((t: string) => `enc:${t}`),
  decryptToken: jest.fn((t: string) => t.replace(/^enc:/, '')),
}));

const caller: AuthUser = {
  id: 'user-1',
  name: 'Manager',
  email: 'mgr@test.com',
  role: Role.MANAGER,
  teamId: null,
  orgId: 'org-1',
};

const orgTemplate = {
  id: 'tpl-1',
  channel: TemplateChannel.EMAIL,
  name: 'My Template',
  subject: 'Hi',
  body: 'Hello {{name}}',
  isSystem: false,
  orgId: 'org-1',
  createdById: 'user-1',
  status: null,
  metaTemplateName: null,
  metaTemplateId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};
const systemTemplate = { ...orgTemplate, id: 'sys-1', name: 'Default', isSystem: true, orgId: null, createdById: null };
const waTemplate = {
  ...orgTemplate,
  id: 'wa-1',
  channel: TemplateChannel.WHATSAPP,
  subject: null,
  status: 'PENDING',
  metaTemplateName: 'welcome_org1_ab12',
};

describe('TemplatesService', () => {
  let service: TemplatesService;
  let prisma: jest.Mocked<PrismaService>;
  let whatsapp: jest.Mocked<WhatsappTemplatesApi>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TemplatesService,
        {
          provide: PrismaService,
          useValue: {
            messageTemplate: {
              findMany: jest.fn(),
              findFirst: jest.fn(),
              create: jest.fn(),
              createMany: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
            },
            orgIntegration: {
              findUnique: jest.fn().mockResolvedValue(null),
              findMany: jest.fn().mockResolvedValue([]),
            },
          },
        },
        {
          provide: WhatsappTemplatesApi,
          useValue: {
            isConfigured: jest.fn().mockReturnValue(false),
            toPositional: jest.fn().mockReturnValue({ text: '', variables: ['name'], example: ['Asha'] }),
            submit: jest.fn(),
            edit: jest.fn(),
            fetchStatuses: jest.fn().mockResolvedValue(new Map()),
          },
        },
      ],
    }).compile();

    service = module.get(TemplatesService);
    prisma = module.get(PrismaService);
    whatsapp = module.get(WhatsappTemplatesApi);
  });

  describe('findAll', () => {
    it('returns system defaults and the org templates (OR-scoped)', async () => {
      (prisma.messageTemplate.findMany as jest.Mock).mockResolvedValue([systemTemplate, orgTemplate]);
      const result = await service.findAll(caller);
      expect(result).toHaveLength(2);
      expect(prisma.messageTemplate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ OR: [{ isSystem: true }, { orgId: 'org-1' }] }),
        }),
      );
    });

    it('narrows to the requested channel when provided', async () => {
      (prisma.messageTemplate.findMany as jest.Mock).mockResolvedValue([waTemplate]);
      await service.findAll(caller, TemplateChannel.WHATSAPP);
      expect(prisma.messageTemplate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [{ isSystem: true }, { orgId: 'org-1' }],
            channel: TemplateChannel.WHATSAPP,
          }),
        }),
      );
    });

    it('excludes hello_world — Meta only lets it send from the Public Test Number', async () => {
      (prisma.messageTemplate.findMany as jest.Mock).mockResolvedValue([]);
      await service.findAll(caller, TemplateChannel.WHATSAPP);
      expect(prisma.messageTemplate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: [{ OR: [{ metaTemplateName: null }, { metaTemplateName: { notIn: ['hello_world'] } }] }],
          }),
        }),
      );
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when not visible to the caller', async () => {
      (prisma.messageTemplate.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(service.findOne('missing', caller)).rejects.toThrow(NotFoundException);
    });

    it('scopes the lookup to system-or-own-org', async () => {
      (prisma.messageTemplate.findFirst as jest.Mock).mockResolvedValue(orgTemplate);
      await service.findOne('tpl-1', caller);
      expect(prisma.messageTemplate.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'tpl-1', OR: [{ isSystem: true }, { orgId: 'org-1' }] }),
        }),
      );
    });
  });

  describe('create', () => {
    it('stamps orgId, createdById and channel on an EMAIL template (no Meta call)', async () => {
      (prisma.messageTemplate.create as jest.Mock).mockResolvedValue(orgTemplate);
      await service.create({ channel: TemplateChannel.EMAIL, name: 'X', subject: 'S', body: 'B' }, caller);
      expect(prisma.messageTemplate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            channel: TemplateChannel.EMAIL,
            subject: 'S',
            orgId: 'org-1',
            createdById: 'user-1',
          }),
        }),
      );
      expect(whatsapp.submit).not.toHaveBeenCalled();
    });

    it('saves a WhatsApp template as DRAFT when Meta is not configured', async () => {
      whatsapp.isConfigured.mockReturnValue(false);
      (prisma.messageTemplate.create as jest.Mock).mockResolvedValue(waTemplate);
      await service.create({ channel: TemplateChannel.WHATSAPP, name: 'Welcome', body: 'Hi {{name}}' }, caller);
      expect(whatsapp.submit).not.toHaveBeenCalled();
      expect(prisma.messageTemplate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            channel: TemplateChannel.WHATSAPP,
            status: 'DRAFT',
            category: 'MARKETING',
            language: 'en_US',
            metaTemplateName: expect.stringMatching(/^welcome_org1_/),
            rejectionReason: expect.any(String),
          }),
        }),
      );
    });

    it('submits a WhatsApp template to Meta and marks it PENDING when configured', async () => {
      whatsapp.isConfigured.mockReturnValue(true);
      whatsapp.submit.mockResolvedValue({ id: 'meta-1', status: 'PENDING', variables: ['name'] });
      (prisma.messageTemplate.create as jest.Mock).mockResolvedValue(waTemplate);
      await service.create({ channel: TemplateChannel.WHATSAPP, name: 'Welcome', body: 'Hi {{name}}' }, caller);
      expect(whatsapp.submit).toHaveBeenCalled();
      expect(prisma.messageTemplate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'PENDING', metaTemplateId: 'meta-1' }),
        }),
      );
    });
  });

  describe('update', () => {
    it('rejects editing a system default', async () => {
      (prisma.messageTemplate.findFirst as jest.Mock).mockResolvedValue(systemTemplate);
      await expect(service.update('sys-1', { name: 'X' }, caller)).rejects.toThrow(ForbiddenException);
      expect(prisma.messageTemplate.update).not.toHaveBeenCalled();
    });

    it('rejects editing a WhatsApp template while it is PENDING review', async () => {
      (prisma.messageTemplate.findFirst as jest.Mock).mockResolvedValue(waTemplate);
      await expect(service.update('wa-1', { body: 'new' }, caller)).rejects.toThrow(ForbiddenException);
      expect(prisma.messageTemplate.update).not.toHaveBeenCalled();
    });

    it('updates an EMAIL org template', async () => {
      (prisma.messageTemplate.findFirst as jest.Mock).mockResolvedValue(orgTemplate);
      (prisma.messageTemplate.update as jest.Mock).mockResolvedValue({ ...orgTemplate, name: 'New' });
      const result = await service.update('tpl-1', { name: 'New' }, caller);
      expect(result.name).toBe('New');
      expect(prisma.messageTemplate.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'tpl-1' } }),
      );
    });
  });

  describe('remove', () => {
    it('rejects deleting a system default', async () => {
      (prisma.messageTemplate.findFirst as jest.Mock).mockResolvedValue(systemTemplate);
      await expect(service.remove('sys-1', caller)).rejects.toThrow(ForbiddenException);
      expect(prisma.messageTemplate.delete).not.toHaveBeenCalled();
    });

    it('deletes an org template', async () => {
      (prisma.messageTemplate.findFirst as jest.Mock).mockResolvedValue(orgTemplate);
      (prisma.messageTemplate.delete as jest.Mock).mockResolvedValue(orgTemplate);
      await service.remove('tpl-1', caller);
      expect(prisma.messageTemplate.delete).toHaveBeenCalledWith({ where: { id: 'tpl-1' } });
    });
  });

  describe('copy', () => {
    it('duplicates a WhatsApp template as a DRAFT, preserving channel', async () => {
      (prisma.messageTemplate.findFirst as jest.Mock).mockResolvedValue({ ...waTemplate, status: 'APPROVED' });
      (prisma.messageTemplate.create as jest.Mock).mockResolvedValue({ ...waTemplate, name: 'Copy of My Template' });
      await service.copy('wa-1', caller);
      expect(prisma.messageTemplate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            channel: TemplateChannel.WHATSAPP,
            name: 'Copy of My Template',
            status: 'DRAFT',
            orgId: 'org-1',
            createdById: 'user-1',
          }),
        }),
      );
    });
  });

  describe('refreshStatuses', () => {
    const remoteStatus = {
      status: 'APPROVED',
      metaTemplateId: 'meta-1',
      language: 'en_US',
      body: 'Hi {{1}}',
      variableCount: 1,
    };

    it('maps Meta statuses onto the caller’s WhatsApp templates', async () => {
      whatsapp.fetchStatuses.mockResolvedValue(new Map([['welcome_org1_ab12', remoteStatus]]));
      (prisma.messageTemplate.update as jest.Mock).mockResolvedValue(waTemplate);
      (prisma.messageTemplate.findMany as jest.Mock).mockResolvedValueOnce([waTemplate]).mockResolvedValueOnce([]);
      await service.refreshStatuses(caller);
      expect(prisma.messageTemplate.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'wa-1' },
          data: expect.objectContaining({ status: 'APPROVED' }),
        }),
      );
    });

    it('imports a WABA template not yet tracked locally, scoped to the caller’s org', async () => {
      whatsapp.fetchStatuses.mockResolvedValue(
        new Map([['order_confirmation', remoteStatus]]),
      );
      (prisma.messageTemplate.findMany as jest.Mock).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      await service.refreshStatuses(caller);
      expect(prisma.messageTemplate.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            channel: TemplateChannel.WHATSAPP,
            name: 'Order Confirmation',
            body: 'Hi {{1}}',
            orgId: 'org-1',
            language: 'en_US',
            metaTemplateName: 'order_confirmation',
            metaTemplateId: 'meta-1',
            status: 'APPROVED',
            variables: ['value1'],
          }),
        ],
      });
    });

    it('never imports hello_world — it can only send from Meta’s Public Test Number', async () => {
      whatsapp.fetchStatuses.mockResolvedValue(new Map([['hello_world', remoteStatus]]));
      (prisma.messageTemplate.findMany as jest.Mock).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      await service.refreshStatuses(caller);
      expect(prisma.messageTemplate.createMany).not.toHaveBeenCalled();
    });

    it('does not re-import a template the caller already tracks', async () => {
      whatsapp.fetchStatuses.mockResolvedValue(new Map([['welcome_org1_ab12', remoteStatus]]));
      (prisma.messageTemplate.findMany as jest.Mock).mockResolvedValueOnce([waTemplate]).mockResolvedValueOnce([]);
      await service.refreshStatuses(caller);
      expect(prisma.messageTemplate.createMany).not.toHaveBeenCalled();
    });

    it('throws BadGatewayException with Meta’s error text on a Meta API failure', async () => {
      whatsapp.fetchStatuses.mockRejectedValue({
        isAxiosError: true,
        response: { data: { error: { message: 'Invalid OAuth access token' } } },
      });
      await expect(service.refreshStatuses(caller)).rejects.toMatchObject({
        response: { message: 'Invalid OAuth access token' },
      });
    });
  });

  describe('per-org WABA credentials', () => {
    const connectedIntegration = {
      status: IntegrationStatus.CONNECTED,
      accessToken: 'enc:org-token',
      metadata: { businessAccountId: 'enc:org-waba-1' },
    };

    it('submits to Meta using the caller’s own connected WABA credentials, not the global config', async () => {
      (prisma.orgIntegration.findUnique as jest.Mock).mockResolvedValue(connectedIntegration);
      whatsapp.isConfigured.mockReturnValue(true);
      whatsapp.submit.mockResolvedValue({ id: 'meta-1', status: 'PENDING', variables: ['name'] });
      (prisma.messageTemplate.create as jest.Mock).mockResolvedValue(waTemplate);

      await service.create({ channel: TemplateChannel.WHATSAPP, name: 'Welcome', body: 'Hi {{name}}' }, caller);

      expect(prisma.orgIntegration.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orgId_provider: { orgId: 'org-1', provider: IntegrationProvider.WHATSAPP } },
        }),
      );
      expect(whatsapp.isConfigured).toHaveBeenCalledWith({ accessToken: 'org-token', businessAccountId: 'org-waba-1' });
      expect(whatsapp.submit).toHaveBeenCalledWith(
        expect.any(Object),
        { accessToken: 'org-token', businessAccountId: 'org-waba-1' },
      );
    });

    it('falls back to undefined (global env) credentials when the org has no WABA connected', async () => {
      (prisma.orgIntegration.findUnique as jest.Mock).mockResolvedValue(null);
      whatsapp.isConfigured.mockReturnValue(false);
      (prisma.messageTemplate.create as jest.Mock).mockResolvedValue(waTemplate);

      await service.create({ channel: TemplateChannel.WHATSAPP, name: 'Welcome', body: 'Hi {{name}}' }, caller);

      expect(whatsapp.isConfigured).toHaveBeenCalledWith(undefined);
      expect(whatsapp.submit).not.toHaveBeenCalled();
    });
  });

  describe('syncPendingStatuses', () => {
    const remoteStatus = {
      status: 'APPROVED',
      metaTemplateId: 'meta-1',
      language: 'en_US',
      body: 'Hi {{1}}',
      variableCount: 1,
    };

    it('fans out to every connected org’s own WABA, scoping each refresh to that org’s pending templates', async () => {
      (prisma.orgIntegration.findMany as jest.Mock).mockResolvedValue([
        {
          orgId: 'org-a',
          status: IntegrationStatus.CONNECTED,
          accessToken: 'enc:token-a',
          metadata: { businessAccountId: 'enc:waba-a' },
        },
        {
          orgId: 'org-b',
          status: IntegrationStatus.CONNECTED,
          accessToken: 'enc:token-b',
          metadata: { businessAccountId: 'enc:waba-b' },
        },
      ]);
      whatsapp.fetchStatuses.mockImplementation(async (creds) => {
        if (creds?.businessAccountId === 'waba-a') return new Map([['tpl_a', remoteStatus]]);
        if (creds?.businessAccountId === 'waba-b') return new Map();
        return new Map();
      });
      whatsapp.isConfigured.mockReturnValue(false);
      (prisma.messageTemplate.findMany as jest.Mock).mockResolvedValue([{ id: 'tpl-a-1', metaTemplateName: 'tpl_a' }]);

      await service.syncPendingStatuses();

      expect(whatsapp.fetchStatuses).toHaveBeenCalledWith({ accessToken: 'token-a', businessAccountId: 'waba-a' });
      expect(whatsapp.fetchStatuses).toHaveBeenCalledWith({ accessToken: 'token-b', businessAccountId: 'waba-b' });
      expect(prisma.messageTemplate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-a' }) }),
      );
      expect(prisma.messageTemplate.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'tpl-a-1' } }),
      );
    });

    it('sweeps every org without its own WABA against the global fallback in one call', async () => {
      (prisma.orgIntegration.findMany as jest.Mock).mockResolvedValue([
        { orgId: 'org-a', status: IntegrationStatus.CONNECTED, accessToken: 'enc:token-a', metadata: { businessAccountId: 'enc:waba-a' } },
      ]);
      whatsapp.fetchStatuses
        .mockResolvedValueOnce(new Map()) // org-a's own WABA — nothing pending
        .mockResolvedValueOnce(new Map([['tpl_global', remoteStatus]])); // global sweep
      whatsapp.isConfigured.mockReturnValue(true);
      (prisma.messageTemplate.findMany as jest.Mock).mockResolvedValue([{ id: 'tpl-g-1', metaTemplateName: 'tpl_global' }]);

      await service.syncPendingStatuses();

      expect(whatsapp.fetchStatuses).toHaveBeenLastCalledWith();
      expect(prisma.messageTemplate.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ OR: [{ orgId: null }, { orgId: { notIn: ['org-a'] } }] }),
        }),
      );
    });

    it('logs and swallows a global-fallback Meta failure instead of failing the job', async () => {
      (prisma.orgIntegration.findMany as jest.Mock).mockResolvedValue([]);
      whatsapp.isConfigured.mockReturnValue(true);
      whatsapp.fetchStatuses.mockRejectedValue(new Error('Invalid OAuth access token'));
      const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      await expect(service.syncPendingStatuses()).resolves.toBeUndefined();

      expect(errorSpy).toHaveBeenCalledWith('WhatsApp template sync failed for global fallback', expect.any(String));
      errorSpy.mockRestore();
    });

    it('does not run the global sweep when no org is connected and the global env is unconfigured', async () => {
      (prisma.orgIntegration.findMany as jest.Mock).mockResolvedValue([]);
      whatsapp.isConfigured.mockReturnValue(false);

      await service.syncPendingStatuses();

      expect(whatsapp.fetchStatuses).not.toHaveBeenCalled();
    });
  });
});
