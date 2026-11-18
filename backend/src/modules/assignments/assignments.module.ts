import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { AssignmentsService } from './assignments.service';
import { AssignmentsController } from './assignments.controller';
import { AssignmentProcessor } from './assignment.processor';
import { MailModule } from '../mail/mail.module';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [BullModule.registerQueue({ name: 'assignment' }), MailModule, BillingModule],
  providers: [AssignmentsService, AssignmentProcessor],
  controllers: [AssignmentsController],
  exports: [AssignmentsService],
})
export class AssignmentsModule {}
