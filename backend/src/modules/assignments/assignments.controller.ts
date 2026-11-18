import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { AssignmentsService } from './assignments.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/types/auth-user.type';
import { Role } from '@prisma/client';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('assignments')
export class AssignmentsController {
  constructor(private assignments: AssignmentsService) {}

  @Roles(Role.DIRECTOR, Role.MANAGER)
  @Post('bulk')
  bulkAssign(@Body() body: { leadIds: string[]; teamId: string }, @CurrentUser() user: AuthUser) {
    return this.assignments.bulkAssign(body.leadIds, body.teamId, user);
  }

  @Roles(Role.DIRECTOR, Role.MANAGER)
  @Post('single')
  assignOne(@Body() body: { leadId: string; teamId: string }, @CurrentUser() user: AuthUser) {
    return this.assignments.assignOne(body.leadId, body.teamId, user);
  }

  @Roles(Role.DIRECTOR, Role.MANAGER)
  @Post('distribute')
  distribute(@Body() body: { leadIds: string[] }, @CurrentUser() user: AuthUser) {
    return this.assignments.distributeRoundRobin(body.leadIds ?? [], user);
  }

  @Roles(Role.DIRECTOR, Role.MANAGER)
  @Post('distribute-all')
  distributeAll(@CurrentUser() user: AuthUser) {
    return this.assignments.distributeAllUnassigned(user);
  }
}
