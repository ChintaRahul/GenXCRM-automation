import { Module } from '@nestjs/common';
import { FacebookService } from './facebook/facebook.service';
import { FacebookController } from './facebook/facebook.controller';
import { GoogleService } from './google/google.service';
import { GoogleController } from './google/google.controller';
import { WebhookService } from './webhook/webhook.service';
import { WebhookController } from './webhook/webhook.controller';
import { HubsService } from './hubs/hubs.service';
import { HubsController } from './hubs/hubs.controller';
import { WhatsappWebhookService } from './whatsapp/whatsapp-webhook.service';
import { WhatsappWebhookController } from './whatsapp/whatsapp-webhook.controller';
import { AssignmentsModule } from '../modules/assignments/assignments.module';
import { NurturingModule } from '../modules/nurturing/nurturing.module';
import { OrganizationsModule } from '../modules/organizations/organizations.module';
import { MailModule } from '../modules/mail/mail.module';
import { IngestionAlertsModule } from '../modules/ingestion-alerts/ingestion-alerts.module';
import { MfgLeadsModule } from '../modules/mfg-leads/mfg-leads.module';

@Module({
  imports: [AssignmentsModule, NurturingModule, OrganizationsModule, MailModule, IngestionAlertsModule, MfgLeadsModule],
  providers: [FacebookService, GoogleService, WebhookService, HubsService, WhatsappWebhookService],
  controllers: [FacebookController, GoogleController, WebhookController, HubsController, WhatsappWebhookController],
  exports: [FacebookService, WebhookService, HubsService],
})
export class IntegrationsModule {}
