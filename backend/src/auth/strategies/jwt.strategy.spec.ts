import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';

const mockPrisma = {
  user: { findUnique: jest.fn() },
};

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;

  beforeEach(() => {
    jest.clearAllMocks();
    strategy = new JwtStrategy(mockPrisma as unknown as PrismaService);
  });

  it('rejects a payload carrying a purpose (e.g. an MFA challenge/setup token)', async () => {
    await expect(strategy.validate({ sub: 'u1', email: 'a@b.com', purpose: 'mfa_challenge' })).rejects.toThrow(
      UnauthorizedException,
    );
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('accepts a normal session payload and returns the active user', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', isActive: true, passwordChangedAt: null });
    const result = await strategy.validate({ sub: 'u1', email: 'a@b.com' });
    expect(result).toEqual(expect.objectContaining({ id: 'u1' }));
  });

  it('rejects when the user is inactive', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', isActive: false, passwordChangedAt: null });
    await expect(strategy.validate({ sub: 'u1', email: 'a@b.com' })).rejects.toThrow(UnauthorizedException);
  });

  it('denormalizes workspaceType from the user\'s org onto the returned AuthUser', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      isActive: true,
      passwordChangedAt: null,
      org: { workspaceType: 'MANUFACTURING' },
    });
    const result = await strategy.validate({ sub: 'u1', email: 'a@b.com' });
    expect(result.workspaceType).toBe('MANUFACTURING');
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ include: { org: { select: { workspaceType: true } } } }),
    );
  });

  it('returns undefined workspaceType when the user has no org yet', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', isActive: true, passwordChangedAt: null, org: null });
    const result = await strategy.validate({ sub: 'u1', email: 'a@b.com' });
    expect(result.workspaceType).toBeUndefined();
  });
});
