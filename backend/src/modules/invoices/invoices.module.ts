import { Module } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { InvoicesController } from './invoices.controller';
import { PaymentGatewaysController } from './payment-gateways.controller';
import { StorageModule } from '../storage/storage.module';
import { MailModule } from '../mail/mail.module';
import { PaymentsModule } from '../payments/payments.module';
import { CommunicationsModule } from '../communications/communications.module';

@Module({
  imports: [StorageModule, MailModule, PaymentsModule, CommunicationsModule],
  providers: [InvoicesService],
  controllers: [InvoicesController, PaymentGatewaysController],
  exports: [InvoicesService],
})
export class InvoicesModule {}
