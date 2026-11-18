import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { GoogleFormsService } from './google-forms.service';
import { GoogleAuthService } from './google-auth.service';
import { ConnectGoogleFormDto } from './dto/connect-google-form.dto';
import { CompleteGoogleConnectionDto } from './dto/complete-google-connection.dto';
import { UpdateGoogleFormDto } from './dto/update-google-form.dto';
import { SendFormDto } from './dto/send-form.dto';
import { QuerySubmissionsDto } from './dto/query-submissions.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/types/auth-user.type';

@Controller('google-forms')
@UseGuards(JwtAuthGuard, RolesGuard)
export class GoogleFormsController {
  constructor(
    private readonly service: GoogleFormsService,
    private readonly auth: GoogleAuthService,
  ) {}

  // Literal routes are declared before ':id' routes so they are never captured as an id.
  @Get('submissions')
  listSubmissions(@Query() query: QuerySubmissionsDto, @CurrentUser() caller: AuthUser) {
    return this.service.listSubmissions(query, caller);
  }

  @Post('send/:leadId')
  send(@Param('leadId') leadId: string, @Body() dto: SendFormDto, @CurrentUser() caller: AuthUser) {
    return this.service.sendFormToLead(leadId, dto, caller);
  }

  @Post(':id/sync')
  sync(@Param('id') id: string, @CurrentUser() caller: AuthUser) {
    return this.service.syncNow(id, caller);
  }

  @Roles(Role.DIRECTOR, Role.MANAGER)
  @Post('connection/init')
  initConnection(@CurrentUser() caller: AuthUser) {
    return this.auth.initConnection(caller);
  }

  @Roles(Role.DIRECTOR, Role.MANAGER)
  @Post('connection/complete')
  completeConnection(@Body() dto: CompleteGoogleConnectionDto, @CurrentUser() caller: AuthUser) {
    return this.auth.completeConnection(caller, dto.code, dto.state);
  }

  @Roles(Role.DIRECTOR, Role.MANAGER)
  @Get('connection')
  getConnection(@CurrentUser() caller: AuthUser) {
    return this.auth.getConnection(caller);
  }

  @Roles(Role.DIRECTOR, Role.MANAGER)
  @Delete('connection')
  disconnect(@CurrentUser() caller: AuthUser) {
    return this.auth.disconnect(caller);
  }

  @Roles(Role.DIRECTOR, Role.MANAGER)
  @Get('picker-token')
  pickerToken(@CurrentUser() caller: AuthUser) {
    return this.auth.getPickerConfig(caller);
  }

  @Roles(Role.DIRECTOR, Role.MANAGER)
  @Post()
  connect(@Body() dto: ConnectGoogleFormDto, @CurrentUser() caller: AuthUser) {
    return this.service.connectForm(dto, caller);
  }

  @Get()
  list(@CurrentUser() caller: AuthUser) {
    return this.service.listForms(caller);
  }

  @Roles(Role.DIRECTOR, Role.MANAGER)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateGoogleFormDto, @CurrentUser() caller: AuthUser) {
    return this.service.updateForm(id, dto, caller);
  }

  @Roles(Role.DIRECTOR, Role.MANAGER)
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() caller: AuthUser) {
    return this.service.deleteForm(id, caller);
  }
}
