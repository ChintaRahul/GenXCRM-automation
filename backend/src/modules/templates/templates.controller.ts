import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { TemplateChannel } from '@prisma/client';
import { TemplatesService } from './templates.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Role } from '@prisma/client';
import type { AuthUser } from '../../common/types/auth-user.type';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('templates')
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  // Reads are open to any authenticated user (e.g. the nurturing step template picker).
  @Get()
  findAll(@CurrentUser() caller: AuthUser, @Query('channel') channel?: TemplateChannel) {
    return this.templates.findAll(caller, channel);
  }

  // Pull latest WhatsApp approval statuses from Meta (manual "Refresh status" action).
  // Declared before the :id routes so "whatsapp" is never read as a template id.
  @Roles(Role.DIRECTOR, Role.MANAGER)
  @Post('whatsapp/refresh')
  refreshWhatsapp(@CurrentUser() caller: AuthUser) {
    return this.templates.refreshStatuses(caller);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() caller: AuthUser) {
    return this.templates.findOne(id, caller);
  }

  @Roles(Role.DIRECTOR, Role.MANAGER)
  @Post()
  create(@Body() dto: CreateTemplateDto, @CurrentUser() caller: AuthUser) {
    return this.templates.create(dto, caller);
  }

  @Roles(Role.DIRECTOR, Role.MANAGER)
  @Post(':id/copy')
  copy(@Param('id') id: string, @CurrentUser() caller: AuthUser) {
    return this.templates.copy(id, caller);
  }

  // (Re)submit a DRAFT/REJECTED WhatsApp template for Meta approval.
  @Roles(Role.DIRECTOR, Role.MANAGER)
  @Post(':id/submit')
  submit(@Param('id') id: string, @CurrentUser() caller: AuthUser) {
    return this.templates.submit(id, caller);
  }

  @Roles(Role.DIRECTOR, Role.MANAGER)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTemplateDto, @CurrentUser() caller: AuthUser) {
    return this.templates.update(id, dto, caller);
  }

  @Roles(Role.DIRECTOR, Role.MANAGER)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @CurrentUser() caller: AuthUser) {
    return this.templates.remove(id, caller);
  }
}
