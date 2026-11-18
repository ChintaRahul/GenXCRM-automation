import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { TutorsService } from './tutors.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Role } from '@prisma/client';
import type { AuthUser } from '../../common/types/auth-user.type';

@Controller('tutors')
export class TutorsController {
  constructor(private tutors: TutorsService) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  list(@Query('includeArchived') includeArchived: string | undefined, @CurrentUser() caller: AuthUser) {
    return this.tutors.list(caller, includeArchived === 'true');
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DIRECTOR, Role.MANAGER)
  @Post()
  create(@Body() dto: { name: string }, @CurrentUser() caller: AuthUser) {
    return this.tutors.create(dto, caller);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DIRECTOR, Role.MANAGER)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: { isActive?: boolean },
    @CurrentUser() caller: AuthUser,
  ) {
    return this.tutors.update(id, dto, caller);
  }
}
