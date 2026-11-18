import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { ApiKeyGuard } from './api-key.guard';

// Tries a normal user JWT first (the common case), falls back to the org's
// API key. Lets a route accept either credential without duplicating it.
@Injectable()
export class JwtOrApiKeyGuard implements CanActivate {
  constructor(
    private jwtGuard: JwtAuthGuard,
    private apiKeyGuard: ApiKeyGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      const ok = await this.jwtGuard.canActivate(context);
      if (ok) return true;
    } catch {
      // fall through to API-key auth
    }
    return this.apiKeyGuard.canActivate(context);
  }
}
