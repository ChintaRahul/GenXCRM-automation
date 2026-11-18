import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { FollowUpRemindersService } from './follow-up-reminders.service';

@Module({
  imports: [MailModule, NotificationsModule],
  providers: [FollowUpRemindersService],
})
export class FollowUpRemindersModule {}
