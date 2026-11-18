import { Module } from '@nestjs/common';
import { CommunicationsService } from './communications.service';
import { CommunicationsController } from './communications.controller';
import { StorageModule } from '../storage/storage.module';
import { BillingModule } from '../billing/billing.module';
import { FirebaseModule } from '../../integrations/firebase/firebase.module';

@Module({
  imports: [StorageModule, BillingModule, FirebaseModule],
  providers: [CommunicationsService],
  controllers: [CommunicationsController],
  exports: [CommunicationsService],
})
export class CommunicationsModule {}
