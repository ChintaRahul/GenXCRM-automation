import { Module } from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { AccountsAdapter } from './accounts.adapter';
import { ContactsModule } from '../contacts/contacts.module';
import { OpportunitiesModule } from '../opportunities/opportunities.module';
import { MfgActivitiesModule } from '../mfg-activities/mfg-activities.module';
import { QuotationsModule } from '../quotations/quotations.module';
import { SalesOrdersModule } from '../sales-orders/sales-orders.module';
import { InstalledAssetsModule } from '../installed-assets/installed-assets.module';
import { ServiceTicketsModule } from '../service-tickets/service-tickets.module';
import { PaymentMilestonesModule } from '../payment-milestones/payment-milestones.module';

@Module({
  imports: [
    ContactsModule,
    OpportunitiesModule,
    MfgActivitiesModule,
    QuotationsModule,
    SalesOrdersModule,
    InstalledAssetsModule,
    ServiceTicketsModule,
    PaymentMilestonesModule,
  ],
  providers: [AccountsService, AccountsAdapter],
  exports: [AccountsService],
})
export class AccountsModule {}
