import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/types/auth-user.type';

@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  findAll(@CurrentUser() caller: AuthUser) {
    return this.notifications.findAllForCaller(caller);
  }

  @Post(':id/read')
  markRead(@Param('id') id: string, @CurrentUser() caller: AuthUser) {
    return this.notifications.markRead(id, caller);
  }

  @Post('read-all')
  markAllRead(@CurrentUser() caller: AuthUser) {
    return this.notifications.markAllRead(caller);
  }
}
