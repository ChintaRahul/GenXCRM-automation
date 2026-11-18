import { Body, Controller, Get, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/types/auth-user.type';
import { OrganizationsService } from './organizations.service';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { UpdateOrgSettingsDto } from './dto/update-org-settings.dto';
import { UpdateFieldMappingsDto } from './dto/update-field-mappings.dto';
import { UploadOrgLogoDto } from './dto/upload-org-logo.dto';
import { QueryAuditLogDto } from './dto/query-audit-log.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Roles(Role.DIRECTOR, Role.MANAGER)
  @Get('me')
  getMine(@CurrentUser() caller: AuthUser) {
    return this.organizations.getProfile(caller);
  }

  // Director-only: edit the org's own profile fields.
  @Roles(Role.DIRECTOR)
  @Patch('me')
  updateMine(@Body() dto: UpdateOrganizationDto, @CurrentUser() caller: AuthUser) {
    return this.organizations.updateOwnOrg(dto, caller);
  }

  @Roles(Role.DIRECTOR, Role.MANAGER)
  @Get('me/settings')
  getSettings(@CurrentUser() caller: AuthUser) {
    return this.organizations.getSettings(caller);
  }

  @Roles(Role.DIRECTOR)
  @Patch('me/settings')
  updateSettings(@Body() dto: UpdateOrgSettingsDto, @CurrentUser() caller: AuthUser) {
    return this.organizations.updateSettings(dto, caller);
  }

  // All roles can read field mappings — the Leads list uses this to render
  // org-defined custom field columns for every role, not just DIRECTOR/MANAGER.
  @Roles(Role.DIRECTOR, Role.MANAGER, Role.SALES_REP)
  @Get('me/field-mappings')
  getFieldMappings(@CurrentUser() caller: AuthUser) {
    return this.organizations.getFieldMappings(caller);
  }

  @Roles(Role.DIRECTOR)
  @Patch('me/field-mappings')
  updateFieldMappings(@Body() dto: UpdateFieldMappingsDto, @CurrentUser() caller: AuthUser) {
    return this.organizations.updateFieldMappings(dto, caller);
  }

  @Roles(Role.DIRECTOR, Role.MANAGER)
  @Get('me/audit-log')
  getAuditLog(@Query() query: QueryAuditLogDto, @CurrentUser() caller: AuthUser) {
    return this.organizations.getAuditLog(query, caller);
  }

  // The org API key is a secret that authenticates inbound lead ingestion: Directors only.
  @Roles(Role.DIRECTOR)
  @Get('me/api-key')
  getApiKey(@CurrentUser() caller: AuthUser) {
    return this.organizations.getApiKey(caller);
  }

  @Roles(Role.DIRECTOR)
  @Post('me/api-key/regenerate')
  regenerateApiKey(@CurrentUser() caller: AuthUser) {
    return this.organizations.regenerateApiKey(caller);
  }

  @Roles(Role.DIRECTOR)
  @Post('me/logo/upload-url')
  getLogoUploadUrl(@Body() dto: UploadOrgLogoDto, @CurrentUser() caller: AuthUser) {
    return this.organizations.getLogoUploadUrl(dto, caller);
  }

  @Roles(Role.DIRECTOR, Role.MANAGER)
  @Get('me/logo/download-url')
  getLogoDownloadUrl(@CurrentUser() caller: AuthUser) {
    return this.organizations.getLogoDownloadUrl(caller);
  }
}
