import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { LeadsService } from './leads.service';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { QueryLeadDto } from './dto/query-lead.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { JwtOrApiKeyGuard } from '../../common/guards/jwt-or-api-key.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/types/auth-user.type';
import { Role } from '@prisma/client';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('leads')
export class LeadsController {
  constructor(private leads: LeadsService) {}

  @Post()
  create(@Body() dto: CreateLeadDto, @CurrentUser() user: AuthUser) {
    return this.leads.create(dto, user);
  }

  @Post('import')
  importLeads(@Body() body: { leads: CreateLeadDto[] }, @CurrentUser() user: AuthUser) {
    return this.leads.importLeads(body.leads ?? [], user);
  }

  @Roles(Role.DIRECTOR, Role.MANAGER)
  @Post('archive')
  archiveMany(@Body() body: { leadIds: string[] }, @CurrentUser() user: AuthUser) {
    return this.leads.archiveMany(body.leadIds ?? [], user);
  }

  @Roles(Role.DIRECTOR, Role.MANAGER)
  @Post('archive-all')
  archiveAll(@Query() query: QueryLeadDto, @CurrentUser() user: AuthUser) {
    return this.leads.archiveAllMatching(query, user);
  }

  // Also accepts the org's API key (Administration > API & Webhooks) as a
  // bearer credential — the smallest useful "third party reads their own
  // org's leads" surface. Overrides the class-level guards for this route only.
  @UseGuards(JwtOrApiKeyGuard)
  @Get()
  findAll(@Query() query: QueryLeadDto, @CurrentUser() user: AuthUser) {
    return this.leads.findAll(query, user);
  }

  @Get('stats/stage')
  stageStats(@Query() query: QueryLeadDto, @CurrentUser() user: AuthUser) {
    return this.leads.getStageStats(user, query);
  }

  @Get('stats/source')
  sourceStats(@CurrentUser() user: AuthUser) {
    return this.leads.getSourceStats(user);
  }

  @Get('follow-ups')
  followUps(@CurrentUser() user: AuthUser) {
    return this.leads.findFollowUps(user);
  }

  @Get('facets')
  facets(@CurrentUser() user: AuthUser) {
    return this.leads.getFacets(user);
  }

  @Get('phone-index')
  phoneIndex(@CurrentUser() user: AuthUser) {
    return this.leads.getPhoneIndex(user);
  }

  @Get('recent')
  recent(@Query('since') since: string, @CurrentUser() user: AuthUser) {
    return this.leads.getRecent(since, user);
  }

  @UseGuards(JwtOrApiKeyGuard)
  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.leads.findOne(id, user);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateLeadDto, @CurrentUser() user: AuthUser) {
    return this.leads.update(id, dto, user);
  }

  @Roles(Role.DIRECTOR, Role.MANAGER)
  @Delete(':id')
  softDelete(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.leads.softDelete(id, user);
  }

  @Post(':id/notes')
  addNote(
    @Param('id') id: string,
    @Body('note') note: string,
    @Body('type') type: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.leads.addNote(id, note, user, type);
  }

  @Patch(':id/reassign')
  reassign(@Param('id') id: string, @Body('userId') userId: string, @CurrentUser() user: AuthUser) {
    return this.leads.reassign(id, userId, user);
  }
}
