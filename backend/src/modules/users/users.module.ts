import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { MailModule } from '../mail/mail.module';
import { BillingModule } from '../billing/billing.module';
import { MfaModule } from '../../auth/mfa.module';

@Module({
  imports: [MailModule, BillingModule, MfaModule],
  providers: [UsersService],
  controllers: [UsersController],
  exports: [UsersService],
})
export class UsersModule {}
