import { Global, Module } from '@nestjs/common';
import { CampaignsService } from './campaigns.service';
import { CampaignsController } from './campaigns.controller';

// Global — resolveHierarchy() is consumed by LeadsService and the Facebook/Google
// integration services, which shouldn't need to import this module explicitly.
@Global()
@Module({
  providers: [CampaignsService],
  controllers: [CampaignsController],
  exports: [CampaignsService],
})
export class CampaignsModule {}
