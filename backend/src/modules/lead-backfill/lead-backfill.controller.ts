import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/types/auth-user.type';
import { LeadBackfillService } from './lead-backfill.service';
import { BackfillLeadsDto } from './dto/backfill-leads.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('lead-backfill')
export class LeadBackfillController {
  constructor(private readonly backfill: LeadBackfillService) {}

  @Roles(Role.DIRECTOR)
  @Post()
  @HttpCode(200)
  run(@Body() dto: BackfillLeadsDto, @CurrentUser() caller: AuthUser) {
    return this.backfill.backfill(dto, caller);
  }
}
