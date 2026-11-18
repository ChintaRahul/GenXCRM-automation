import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { Request } from 'express';

const WINDOW_MS = 60_000;
// Ten a minute by default; the automated-test stack raises it (AUTH_RATE_LIMIT_MAX) because its setup logs in a dozen users at once.
const MAX_ATTEMPTS = Number(process.env.AUTH_RATE_LIMIT_MAX) || 10;

// Throttles the public auth routes per client IP: more than 10 calls a minute get a 429.
@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  readonly #hits = new Map<string, number[]>();

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const forwarded = req.headers['x-forwarded-for'];
    const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0].trim() ?? req.ip ?? 'unknown';
    const key = `${ip}:${req.path}`;
    const now = Date.now();
    const recent = (this.#hits.get(key) ?? []).filter((at) => now - at < WINDOW_MS);
    if (recent.length >= MAX_ATTEMPTS) {
      throw new HttpException('Too many attempts. Please wait a minute and try again.', HttpStatus.TOO_MANY_REQUESTS);
    }
    this.#hits.set(key, [...recent, now]);
    if (this.#hits.size > 5000) {
      for (const [k, v] of this.#hits) if (now - v[v.length - 1] >= WINDOW_MS) this.#hits.delete(k);
    }
    return true;
  }
}
