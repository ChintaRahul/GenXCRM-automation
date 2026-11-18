import { ExecutionContext } from '@nestjs/common';
import { JwtOrApiKeyGuard } from './jwt-or-api-key.guard';
import { JwtAuthGuard } from './jwt-auth.guard';
import { ApiKeyGuard } from './api-key.guard';

describe('JwtOrApiKeyGuard', () => {
  const ctx = {} as ExecutionContext;

  it('short-circuits on a valid JWT without touching the API-key guard', async () => {
    const jwtGuard = { canActivate: jest.fn().mockResolvedValue(true) };
    const apiKeyGuard = { canActivate: jest.fn() };
    const guard = new JwtOrApiKeyGuard(jwtGuard as unknown as JwtAuthGuard, apiKeyGuard as unknown as ApiKeyGuard);

    expect(await guard.canActivate(ctx)).toBe(true);
    expect(apiKeyGuard.canActivate).not.toHaveBeenCalled();
  });

  it('falls through to the API-key guard when the JWT guard throws', async () => {
    const jwtGuard = { canActivate: jest.fn().mockRejectedValue(new Error('no token')) };
    const apiKeyGuard = { canActivate: jest.fn().mockResolvedValue(true) };
    const guard = new JwtOrApiKeyGuard(jwtGuard as unknown as JwtAuthGuard, apiKeyGuard as unknown as ApiKeyGuard);

    expect(await guard.canActivate(ctx)).toBe(true);
    expect(apiKeyGuard.canActivate).toHaveBeenCalledWith(ctx);
  });

  it('falls through to the API-key guard when the JWT guard resolves false', async () => {
    const jwtGuard = { canActivate: jest.fn().mockResolvedValue(false) };
    const apiKeyGuard = { canActivate: jest.fn().mockResolvedValue(false) };
    const guard = new JwtOrApiKeyGuard(jwtGuard as unknown as JwtAuthGuard, apiKeyGuard as unknown as ApiKeyGuard);

    expect(await guard.canActivate(ctx)).toBe(false);
    expect(apiKeyGuard.canActivate).toHaveBeenCalledWith(ctx);
  });
});
