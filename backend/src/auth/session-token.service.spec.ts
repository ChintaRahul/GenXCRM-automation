import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { SessionTokenService } from './session-token.service';
import { PrismaService } from '../prisma/prisma.service';

const mockJwt = { sign: jest.fn().mockReturnValue('signed-token') };
const mockPrisma = { organization: { findUnique: jest.fn() } };

describe('SessionTokenService', () => {
  let service: SessionTokenService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        SessionTokenService,
        { provide: JwtService, useValue: mockJwt },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(SessionTokenService);
  });

  it('signs with the org\'s configured sessionTimeoutMinutes', async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({ securitySettings: { sessionTimeoutMinutes: 30 } });
    const token = await service.mint({ id: 'u1', email: 'a@b.com', role: 'DIRECTOR', orgId: 'org-1' });

    expect(token).toBe('signed-token');
    expect(mockPrisma.organization.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'org-1' } }),
    );
    expect(mockJwt.sign).toHaveBeenCalledWith(
      { sub: 'u1', email: 'a@b.com', role: 'DIRECTOR', orgId: 'org-1' },
      { expiresIn: '30m' },
    );
  });

  it('falls back to the 60-minute default when the org has not configured a value', async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({ securitySettings: null });
    await service.mint({ id: 'u1', email: 'a@b.com', role: 'DIRECTOR', orgId: 'org-1' });
    expect(mockJwt.sign).toHaveBeenCalledWith(expect.anything(), { expiresIn: '60m' });
  });

  it('falls back to JWT_EXPIRES_IN (or 7d) when the user has no orgId yet (pre-org-setup)', async () => {
    await service.mint({ id: 'u1', email: 'a@b.com', role: 'DIRECTOR', orgId: null });
    expect(mockPrisma.organization.findUnique).not.toHaveBeenCalled();
    expect(mockJwt.sign).toHaveBeenCalledWith(expect.anything(), { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
  });

  it('clamps a stored value below the 5-minute floor (defensive — updateSettings should already reject this)', async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({ securitySettings: { sessionTimeoutMinutes: 0 } });
    await service.mint({ id: 'u1', email: 'a@b.com', role: 'DIRECTOR', orgId: 'org-1' });
    expect(mockJwt.sign).toHaveBeenCalledWith(expect.anything(), { expiresIn: '5m' });
  });

  it('clamps a stored value above the 7-day ceiling (defensive — updateSettings should already reject this)', async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({ securitySettings: { sessionTimeoutMinutes: 999999 } });
    await service.mint({ id: 'u1', email: 'a@b.com', role: 'DIRECTOR', orgId: 'org-1' });
    expect(mockJwt.sign).toHaveBeenCalledWith(expect.anything(), { expiresIn: '10080m' });
  });

  it('includes impersonatedBy in the payload when set', async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({ securitySettings: null });
    await service.mint({ id: 'u1', email: 'a@b.com', role: 'DIRECTOR', orgId: 'org-1', impersonatedBy: 'dir-1' });
    expect(mockJwt.sign).toHaveBeenCalledWith(
      expect.objectContaining({ impersonatedBy: 'dir-1' }),
      expect.anything(),
    );
  });
});
