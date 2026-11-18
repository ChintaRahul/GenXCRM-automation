import { Controller, Get, Post, Body, Param, Query, Delete, Patch, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { RegisterPushTokenDto } from './dto/register-push-token.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Role, TeamType } from '@prisma/client';
import type { AuthUser } from '../../common/types/auth-user.type';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Roles(Role.DIRECTOR, Role.MANAGER)
  @Post()
  create(@Body() dto: CreateUserDto, @CurrentUser() caller: AuthUser) {
    return this.users.create(dto, caller);
  }

  @Get()
  findAll(@Query('include') include: string | undefined, @CurrentUser() user: AuthUser) {
    return this.users.findAll(user, include === 'openLeads');
  }

  // Names of everyone in the organisation (id + name + role only), for owner / engineer pickers and name
  // lookups. Declared before ':id'. Unlike GET /users it is not narrowed to the caller's own visibility.
  @Get('directory')
  directory(@CurrentUser() user: AuthUser) {
    return this.users.directory(user);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() caller: AuthUser) {
    return this.users.findOne(id, caller);
  }

  @Post('me/push-token')
  registerPushToken(@Body() dto: RegisterPushTokenDto, @CurrentUser() caller: AuthUser) {
    return this.users.registerPushToken(dto.token, caller);
  }

  @Get('teams/all')
  findTeams(@CurrentUser() caller: AuthUser) {
    return this.users.findAllTeams(caller);
  }

  @Roles(Role.DIRECTOR, Role.MANAGER)
  @Post('teams')
  createTeam(
    @Body() body: { name: string; managerId?: string; type?: TeamType },
    @CurrentUser() caller: AuthUser,
  ) {
    return this.users.createTeam(body.name, body.managerId, body.type, caller);
  }

  // Declare me/teams/:id routes BEFORE :id to prevent them matching the :id wildcard.
  // No @Roles — any authenticated user may update their own profile.
  @Patch('me')
  updateMe(@Body() dto: UpdateMeDto, @CurrentUser() caller: AuthUser) {
    return this.users.updateMe(dto, caller);
  }

  @Roles(Role.DIRECTOR)
  @Patch('teams/:id')
  updateTeam(
    @Param('id') id: string,
    @Body() body: { name?: string; managerId?: string | null; type?: TeamType; monthlyTarget?: number },
    @CurrentUser() caller: AuthUser,
  ) {
    return this.users.updateTeam(id, body, caller);
  }

  @Roles(Role.DIRECTOR)
  @Delete('teams/:id')
  deleteTeam(@Param('id') id: string, @CurrentUser() caller: AuthUser) {
    return this.users.deleteTeam(id, caller);
  }

  @Roles(Role.DIRECTOR, Role.MANAGER)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto, @CurrentUser() caller: AuthUser) {
    return this.users.update(id, dto, caller);
  }

  @Roles(Role.DIRECTOR, Role.MANAGER)
  @Post(':id/resend-invite')
  resendInvite(@Param('id') id: string, @CurrentUser() caller: AuthUser) {
    return this.users.resendInvite(id, caller);
  }

  @Roles(Role.DIRECTOR)
  @Post(':id/mfa/reset')
  async resetMfa(@Param('id') id: string, @CurrentUser() caller: AuthUser) {
    await this.users.resetMfa(id, caller);
    return { reset: true };
  }

  @Roles(Role.DIRECTOR)
  @Delete(':id')
  deactivate(@Param('id') id: string, @CurrentUser() caller: AuthUser) {
    return this.users.deactivate(id, caller);
  }
}
