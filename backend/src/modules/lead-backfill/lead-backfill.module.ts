import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { LeadBackfillController } from './lead-backfill.controller';
import { LeadBackfillService } from './lead-backfill.service';

@Module({
  imports: [OrganizationsModule],
  controllers: [LeadBackfillController],
  providers: [LeadBackfillService],
})
export class LeadBackfillModule {}
