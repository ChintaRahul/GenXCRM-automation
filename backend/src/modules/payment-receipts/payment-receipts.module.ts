import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { BillingModule } from '../billing/billing.module';
import { StorageModule } from '../storage/storage.module';
import { PaymentReceiptsService } from './payment-receipts.service';

@Module({
  imports: [MailModule, BillingModule, StorageModule],
  providers: [PaymentReceiptsService],
  exports: [PaymentReceiptsService],
})
export class PaymentReceiptsModule {}
