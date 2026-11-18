import { Global, Module } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { ApiKeyGuard } from './api-key.guard';
import { JwtOrApiKeyGuard } from './jwt-or-api-key.guard';

// Global so any controller can reference JwtOrApiKeyGuard (or its parts) via
// @UseGuards() without each feature module having to import this one.
@Global()
@Module({
  providers: [JwtAuthGuard, ApiKeyGuard, JwtOrApiKeyGuard],
  exports: [JwtAuthGuard, ApiKeyGuard, JwtOrApiKeyGuard],
})
export class GuardsModule {}
