import { Module } from '@nestjs/common';
import { ContactsService } from './contacts.service';
import { ContactsAdapter } from './contacts.adapter';
import { MfgActivitiesModule } from '../mfg-activities/mfg-activities.module';

@Module({
  imports: [MfgActivitiesModule],
  providers: [ContactsService, ContactsAdapter],
  exports: [ContactsService],
})
export class ContactsModule {}
