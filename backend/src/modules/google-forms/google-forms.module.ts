import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { GoogleFormsController } from './google-forms.controller';
import { GoogleFormsService } from './google-forms.service';
import { GoogleAuthService } from './google-auth.service';
import { GoogleApiClient } from './google-api.client';
import { FormSubmissionsService } from './form-submissions.service';
import { FormSyncService } from './form-sync.service';
import { FormSyncProcessor } from './form-sync.processor';
import { PrismaModule } from '../../prisma/prisma.module';
import { CommunicationsModule } from '../communications/communications.module';
import { IntegrationsModule } from '../../integrations/integrations.module';

@Module({
  imports: [PrismaModule, CommunicationsModule, IntegrationsModule, BullModule.registerQueue({ name: 'form-sync' })],
  controllers: [GoogleFormsController],
  providers: [GoogleFormsService, GoogleAuthService, GoogleApiClient, FormSubmissionsService, FormSyncService, FormSyncProcessor],
})
export class GoogleFormsModule {}
