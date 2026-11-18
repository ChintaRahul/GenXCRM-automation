import { HttpException } from '@nestjs/common';
import { AuthRateLimitGuard } from './auth-rate-limit.guard';

const ctx = (ip: string) =>
  ({ switchToHttp: () => ({ getRequest: () => ({ headers: { 'x-forwarded-for': ip }, path: '/auth/login' }) }) }) as never;

describe('AuthRateLimitGuard', () => {
  it('allows 10 calls a minute per IP, then answers 429', () => {
    const guard = new AuthRateLimitGuard();
    for (let i = 0; i < 10; i++) expect(guard.canActivate(ctx('1.1.1.1'))).toBe(true);
    expect(() => guard.canActivate(ctx('1.1.1.1'))).toThrow(HttpException);
  });

  it('counts each IP separately', () => {
    const guard = new AuthRateLimitGuard();
    for (let i = 0; i < 10; i++) guard.canActivate(ctx('1.1.1.1'));
    expect(guard.canActivate(ctx('2.2.2.2'))).toBe(true);
  });
});
