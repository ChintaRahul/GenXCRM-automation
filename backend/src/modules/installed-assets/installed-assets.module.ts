import { Module } from '@nestjs/common';
import { InstalledAssetsService } from './installed-assets.service';
import { InstalledAssetsAdapter } from './installed-assets.adapter';
import { CoverageModule } from '../coverage/coverage.module';
import { ServiceTicketsModule } from '../service-tickets/service-tickets.module';

@Module({
  imports: [CoverageModule, ServiceTicketsModule],
  providers: [InstalledAssetsService, InstalledAssetsAdapter],
  exports: [InstalledAssetsService],
})
export class InstalledAssetsModule {}
