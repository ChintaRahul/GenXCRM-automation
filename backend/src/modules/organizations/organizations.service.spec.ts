import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { OrganizationsService } from './organizations.service';
import type { AuthUser } from '../../common/types/auth-user.type';

const director = { id: 'u1', role: Role.DIRECTOR, orgId: 'org-1' } as AuthUser;

describe('OrganizationsService', () => {
  let service: OrganizationsService;
  let prisma: {
    organization: { update: jest.Mock; findUnique: jest.Mock };
    auditLog: { findMany: jest.Mock; count: jest.Mock };
    messageTemplate: { findFirst: jest.Mock };
  };
  let storage: { buildOrgLogoKey: jest.Mock; getPresignedUploadUrl: jest.Mock; getPresignedDownloadUrl: jest.Mock };

  beforeEach(async () => {
    prisma = {
      organization: {
        update: jest.fn().mockResolvedValue({ id: 'org-1' }),
        findUnique: jest.fn(),
      },
      auditLog: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
      messageTemplate: { findFirst: jest.fn() },
    };
    storage = {
      buildOrgLogoKey: jest.fn().mockReturnValue('orgs/org-1/logo.png'),
      getPresignedUploadUrl: jest.fn().mockResolvedValue('https://s3.example.com/upload'),
      getPresignedDownloadUrl: jest.fn().mockResolvedValue('https://s3.example.com/download'),
    };
    const module = await Test.createTestingModule({
      providers: [
        OrganizationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
      ],
    }).compile();
    service = module.get(OrganizationsService);
  });

  it('scopes the update to the caller orgId', async () => {
    await service.updateOwnOrg({ gstNumber: '29ABCDE1234F1Z5' }, director);
    expect(prisma.organization.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'org-1' } }));
  });

  it('trims and uppercases the GSTIN', async () => {
    await service.updateOwnOrg({ gstNumber: ' 29abcde1234f1z5 ' }, director);
    expect(prisma.organization.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { gstNumber: '29ABCDE1234F1Z5' } }),
    );
  });

  it('clears the GSTIN to null on empty string', async () => {
    await service.updateOwnOrg({ gstNumber: '' }, director);
    expect(prisma.organization.update).toHaveBeenCalledWith(expect.objectContaining({ data: { gstNumber: null } }));
  });

  it('does not write gstNumber when omitted', async () => {
    await service.updateOwnOrg({}, director);
    expect(prisma.organization.update).toHaveBeenCalledWith(expect.objectContaining({ data: {} }));
  });

  it('writes notifyRepOnAssignment when provided', async () => {
    await service.updateOwnOrg({ notifyRepOnAssignment: false }, director);
    expect(prisma.organization.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { notifyRepOnAssignment: false } }),
    );
  });

  it('writes email and phone when provided', async () => {
    await service.updateOwnOrg({ email: 'hello@org.com', phone: '+91 98765 43210' }, director);
    expect(prisma.organization.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { email: 'hello@org.com', phone: '+91 98765 43210' } }),
    );
  });

  it('clears email and phone to null on empty string', async () => {
    await service.updateOwnOrg({ email: '', phone: '' }, director);
    expect(prisma.organization.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { email: null, phone: null } }),
    );
  });

  describe('getLogoUploadUrl', () => {
    it('builds a key scoped to the caller org, persists it, and returns the upload url', async () => {
      const result = await service.getLogoUploadUrl({ contentType: 'image/png' }, director);
      expect(storage.buildOrgLogoKey).toHaveBeenCalledWith('org-1', 'png');
      expect(storage.getPresignedUploadUrl).toHaveBeenCalledWith('orgs/org-1/logo.png', 'image/png');
      expect(prisma.organization.update).toHaveBeenCalledWith({
        where: { id: 'org-1' },
        data: { logoKey: 'orgs/org-1/logo.png' },
      });
      expect(result).toEqual({ uploadUrl: 'https://s3.example.com/upload' });
    });

    it('throws when the caller has no organization', async () => {
      await expect(
        service.getLogoUploadUrl({ contentType: 'image/png' }, { ...director, orgId: null } as AuthUser),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getLogoDownloadUrl', () => {
    it('returns a fresh signed url when a logo is set', async () => {
      prisma.organization.findUnique.mockResolvedValue({ logoKey: 'orgs/org-1/logo.png' });
      const result = await service.getLogoDownloadUrl(director);
      expect(storage.getPresignedDownloadUrl).toHaveBeenCalledWith('orgs/org-1/logo.png');
      expect(result).toEqual({ url: 'https://s3.example.com/download' });
    });

    it('returns a null url when no logo is set', async () => {
      prisma.organization.findUnique.mockResolvedValue({ logoKey: null });
      const result = await service.getLogoDownloadUrl(director);
      expect(storage.getPresignedDownloadUrl).not.toHaveBeenCalled();
      expect(result).toEqual({ url: null });
    });
  });

  it('throws when the caller has no organization', async () => {
    await expect(
      service.updateOwnOrg({ gstNumber: '29ABCDE1234F1Z5' }, { ...director, orgId: null } as AuthUser),
    ).rejects.toThrow(ForbiddenException);
  });

  it('scopes getProfile to the caller orgId and returns the profile shape', async () => {
    prisma.organization.findUnique = jest.fn().mockResolvedValue({
      id: 'org-1',
      name: 'Acme EdTech',
      website: 'https://acme.example',
      industry: 'EDTECH',
      size: 'SMALL',
      city: 'Pune',
      state: 'MH',
      country: 'India',
      timezone: 'Asia/Kolkata',
      gstNumber: null,
      notifyRepOnAssignment: true,
      planStatus: 'TRIAL',
      trialEndsAt: new Date('2026-10-01'),
    });
    const result = await service.getProfile(director);
    expect(prisma.organization.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'org-1' } }));
    expect(result.name).toBe('Acme EdTech');
  });

  it('getProfile throws when the caller has no organization', async () => {
    await expect(service.getProfile({ ...director, orgId: null } as AuthUser)).rejects.toThrow(ForbiddenException);
  });

  it('updateOwnOrg writes the extended profile fields', async () => {
    await service.updateOwnOrg(
      {
        name: 'New Name',
        website: 'https://new.example',
        industry: 'SAAS_TECHNOLOGY',
        size: 'MEDIUM',
        city: 'Mumbai',
        state: 'MH',
        timezone: 'Asia/Kolkata',
      },
      director,
    );
    expect(prisma.organization.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'org-1' },
        data: expect.objectContaining({
          name: 'New Name',
          website: 'https://new.example',
          industry: 'SAAS_TECHNOLOGY',
          size: 'MEDIUM',
          city: 'Mumbai',
          state: 'MH',
          timezone: 'Asia/Kolkata',
        }),
      }),
    );
  });

  it('getSettings returns defaults when nothing has been saved yet', async () => {
    prisma.organization.findUnique = jest.fn().mockResolvedValue({
      securitySettings: null,
      notificationSettings: null,
      routingSettings: null,
    });
    const result = await service.getSettings(director);
    expect(prisma.organization.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'org-1' } }));
    expect(result.security.passwordMinLength).toBe(8);
    expect(result.notifications.newLeadAssigned).toEqual({ email: true, inApp: true });
    expect(result.routing.autoAssign).toBe(true);
  });

  it('getSettings returns the stored blob when present', async () => {
    prisma.organization.findUnique = jest.fn().mockResolvedValue({
      securitySettings: {
        passwordMinLength: 12,
        sessionTimeoutMinutes: 30,
        requireNumber: true,
        requireSymbol: true,
        mfaEnabled: true,
        mfaEnforced: false,
        ssoProvider: 'NONE',
        ssoConnected: false,
      },
      notificationSettings: null,
      routingSettings: null,
    });
    const result = await service.getSettings(director);
    expect(result.security.passwordMinLength).toBe(12);
  });

  it('updateSettings writes the security section scoped to caller orgId', async () => {
    prisma.organization.update = jest.fn().mockResolvedValue({
      securitySettings: {
        passwordMinLength: 10,
        sessionTimeoutMinutes: 60,
        requireNumber: true,
        requireSymbol: false,
        mfaEnabled: false,
        mfaEnforced: false,
        ssoProvider: 'NONE',
        ssoConnected: false,
      },
      notificationSettings: null,
      routingSettings: null,
    });
    await service.updateSettings(
      {
        security: {
          passwordMinLength: 10,
          sessionTimeoutMinutes: 60,
          requireNumber: true,
          requireSymbol: false,
          mfaEnabled: false,
          mfaEnforced: false,
          ssoProvider: 'NONE',
          ssoConnected: false,
        },
      },
      director,
    );
    expect(prisma.organization.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'org-1' },
        data: expect.objectContaining({
          securitySettings: expect.objectContaining({ passwordMinLength: 10 }),
        }),
      }),
    );
  });

  it('updateSettings rejects a sessionTimeoutMinutes below the 5-minute floor', async () => {
    await expect(service.updateSettings({ security: { sessionTimeoutMinutes: 1 } }, director)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('updateSettings rejects a sessionTimeoutMinutes above the 7-day ceiling', async () => {
    await expect(service.updateSettings({ security: { sessionTimeoutMinutes: 10081 } }, director)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('updateSettings accepts sessionTimeoutMinutes at the boundaries (5 and 10080)', async () => {
    prisma.organization.update = jest.fn().mockResolvedValue({
      securitySettings: { sessionTimeoutMinutes: 5 },
      notificationSettings: null,
      routingSettings: null,
    });
    await expect(service.updateSettings({ security: { sessionTimeoutMinutes: 5 } }, director)).resolves.toBeDefined();

    prisma.organization.update = jest.fn().mockResolvedValue({
      securitySettings: { sessionTimeoutMinutes: 10080 },
      notificationSettings: null,
      routingSettings: null,
    });
    await expect(
      service.updateSettings({ security: { sessionTimeoutMinutes: 10080 } }, director),
    ).resolves.toBeDefined();
  });

  it('updateSettings writes payments.emiReminderTemplateId when it resolves to an approved, org-owned WhatsApp template', async () => {
    prisma.messageTemplate.findFirst.mockResolvedValue({ id: 'tpl-1' });
    prisma.organization.update = jest.fn().mockResolvedValue({
      securitySettings: null,
      notificationSettings: null,
      routingSettings: null,
      paymentSettings: { emiReminderTemplateId: 'tpl-1' },
    });

    await service.updateSettings({ payments: { emiReminderTemplateId: 'tpl-1' } }, director);

    expect(prisma.messageTemplate.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'tpl-1', orgId: 'org-1', channel: 'WHATSAPP', status: 'APPROVED' },
      }),
    );
    expect(prisma.organization.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          paymentSettings: { emiReminderTemplateId: 'tpl-1', emiReminderEmailTemplateId: null },
        }),
      }),
    );
  });

  it('updateSettings rejects an emiReminderTemplateId that is not an approved, org-owned WhatsApp template', async () => {
    prisma.messageTemplate.findFirst.mockResolvedValue(null);
    await expect(
      service.updateSettings({ payments: { emiReminderTemplateId: 'tpl-other-org' } }, director),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.organization.update).not.toHaveBeenCalled();
  });

  it('updateSettings writes payments.emiReminderEmailTemplateId when it resolves to an org-owned EMAIL template', async () => {
    prisma.messageTemplate.findFirst.mockResolvedValue({ id: 'tpl-email' });
    prisma.organization.update = jest.fn().mockResolvedValue({
      securitySettings: null,
      notificationSettings: null,
      routingSettings: null,
      paymentSettings: { emiReminderEmailTemplateId: 'tpl-email' },
    });

    await service.updateSettings({ payments: { emiReminderEmailTemplateId: 'tpl-email' } }, director);

    expect(prisma.messageTemplate.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'tpl-email', orgId: 'org-1', channel: 'EMAIL' } }),
    );
    expect(prisma.organization.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          paymentSettings: { emiReminderTemplateId: null, emiReminderEmailTemplateId: 'tpl-email' },
        }),
      }),
    );
  });

  it('updateSettings rejects an emiReminderEmailTemplateId that is not an org-owned EMAIL template', async () => {
    prisma.messageTemplate.findFirst.mockResolvedValue(null);
    await expect(
      service.updateSettings({ payments: { emiReminderEmailTemplateId: 'tpl-other-org' } }, director),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.organization.update).not.toHaveBeenCalled();
  });

  it('updateSettings allows clearing emiReminderTemplateId back to null without a lookup', async () => {
    prisma.organization.update = jest.fn().mockResolvedValue({
      securitySettings: null,
      notificationSettings: null,
      routingSettings: null,
      paymentSettings: { emiReminderTemplateId: null },
    });

    await service.updateSettings({ payments: { emiReminderTemplateId: null } }, director);

    expect(prisma.messageTemplate.findFirst).not.toHaveBeenCalled();
    expect(prisma.organization.update).toHaveBeenCalled();
  });

  it('getSettings throws when the caller has no organization', async () => {
    await expect(service.getSettings({ ...director, orgId: null } as AuthUser)).rejects.toThrow(ForbiddenException);
  });

  it('getFieldMappings returns default empty aliases when nothing saved', async () => {
    prisma.organization.findUnique = jest.fn().mockResolvedValue({
      coreFieldAliases: null,
      customFieldDefs: null,
      detectedFormFields: null,
    });
    const result = await service.getFieldMappings(director);
    expect(result.coreFieldAliases.name).toBe('');
    expect(result.customFieldDefs).toEqual([]);
    expect(result.detectedFields).toEqual([]);
  });

  it('getFieldMappings returns the stored detected fields', async () => {
    prisma.organization.findUnique = jest.fn().mockResolvedValue({
      coreFieldAliases: null,
      customFieldDefs: null,
      detectedFormFields: ['Preferred Batch', 'Budget'],
    });
    const result = await service.getFieldMappings(director);
    expect(result.detectedFields).toEqual(['Preferred Batch', 'Budget']);
  });

  it('updateFieldMappings writes both sections scoped to caller orgId', async () => {
    prisma.organization.update = jest.fn().mockResolvedValue({
      coreFieldAliases: { name: 'Full Name, Name, Lead Name' },
      customFieldDefs: [{ id: 'c1', name: 'Batch', aliases: 'Batch, Cohort' }],
      detectedFormFields: ['Preferred Batch'],
    });
    const result = await service.updateFieldMappings(
      {
        coreFieldAliases: { name: 'Full Name, Name, Lead Name' },
        customFieldDefs: [{ id: 'c1', name: 'Batch', aliases: 'Batch, Cohort' }],
      },
      director,
    );
    expect(prisma.organization.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'org-1' },
        data: expect.objectContaining({
          coreFieldAliases: expect.objectContaining({ name: 'Full Name, Name, Lead Name' }),
          customFieldDefs: [{ id: 'c1', name: 'Batch', aliases: 'Batch, Cohort' }],
        }),
      }),
    );
    expect(result.detectedFields).toEqual(['Preferred Batch']);
  });

  it('getFieldMappings throws when the caller has no organization', async () => {
    await expect(service.getFieldMappings({ ...director, orgId: null } as AuthUser)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('getAuditLog scopes to the caller orgId via the user relation and paginates', async () => {
    prisma.auditLog.findMany = jest
      .fn()
      .mockResolvedValue([
        { id: 'a1', action: 'LOGIN', ipAddress: '1.2.3.4', createdAt: new Date('2026-09-01'), user: { name: 'Rahul' } },
      ]);
    prisma.auditLog.count = jest.fn().mockResolvedValue(1);
    const result = await service.getAuditLog({ page: 1, pageSize: 20 }, director);
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { user: { orgId: 'org-1' } },
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 20,
      }),
    );
    expect(result.items).toEqual([
      { id: 'a1', action: 'LOGIN', userName: 'Rahul', time: new Date('2026-09-01'), ipAddress: '1.2.3.4' },
    ]);
    expect(result.total).toBe(1);
  });

  it('getAuditLog computes skip from page and pageSize', async () => {
    await service.getAuditLog({ page: 3, pageSize: 10 }, director);
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 20, take: 10 }));
  });

  it('getAuditLog throws when the caller has no organization', async () => {
    await expect(
      service.getAuditLog({ page: 1, pageSize: 20 }, { ...director, orgId: null } as AuthUser),
    ).rejects.toThrow(ForbiddenException);
  });

  it('getApiKey returns the existing key without writing when already set', async () => {
    prisma.organization.findUnique = jest.fn().mockResolvedValue({ apiKey: 'gxc_live_existingkey123' });
    const result = await service.getApiKey(director);
    expect(result.apiKey).toBe('gxc_live_existingkey123');
    expect(prisma.organization.update).not.toHaveBeenCalled();
  });

  it('getApiKey generates and persists a key on first access', async () => {
    prisma.organization.findUnique = jest.fn().mockResolvedValue({ apiKey: null });
    prisma.organization.update = jest.fn().mockResolvedValue({ apiKey: 'gxc_live_generated' });
    const result = await service.getApiKey(director);
    expect(prisma.organization.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'org-1' } }));
    expect(result.apiKey).toMatch(/^gxc_live_/);
  });

  it('regenerateApiKey always writes a fresh key scoped to caller orgId', async () => {
    prisma.organization.update = jest.fn().mockResolvedValue({ apiKey: 'gxc_live_fresh' });
    const result = await service.regenerateApiKey(director);
    expect(prisma.organization.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'org-1' },
        data: expect.objectContaining({ apiKey: expect.stringMatching(/^gxc_live_/) }),
      }),
    );
    expect(result.apiKey).toBe('gxc_live_fresh');
  });

  it('getApiKey throws when the caller has no organization', async () => {
    await expect(service.getApiKey({ ...director, orgId: null } as AuthUser)).rejects.toThrow(ForbiddenException);
  });

  describe('recordDetectedFields', () => {
    it('does nothing when no keys are passed', async () => {
      await service.recordDetectedFields('org-1', []);
      expect(prisma.organization.findUnique).not.toHaveBeenCalled();
    });

    it('adds new keys ahead of the existing list, capped and deduped case-insensitively', async () => {
      prisma.organization.findUnique = jest.fn().mockResolvedValue({ detectedFormFields: ['Budget'] });
      await service.recordDetectedFields('org-1', ['Preferred Batch', 'budget']);
      expect(prisma.organization.update).toHaveBeenCalledWith({
        where: { id: 'org-1' },
        data: { detectedFormFields: ['Preferred Batch', 'Budget'] },
      });
    });

    it('skips the write when all keys are already known', async () => {
      prisma.organization.findUnique = jest.fn().mockResolvedValue({ detectedFormFields: ['Budget'] });
      await service.recordDetectedFields('org-1', ['budget']);
      expect(prisma.organization.update).not.toHaveBeenCalled();
    });

    it('never throws when the prisma call fails', async () => {
      prisma.organization.findUnique = jest.fn().mockRejectedValue(new Error('db down'));
      await expect(service.recordDetectedFields('org-1', ['Budget'])).resolves.toBeUndefined();
    });
  });
});
