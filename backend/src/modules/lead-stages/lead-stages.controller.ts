import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/types/auth-user.type';
import { LeadStagesService } from './lead-stages.service';
import { CreateStageDto } from './dto/create-stage.dto';
import { UpdateStageDto } from './dto/update-stage.dto';
import { ReorderStagesDto } from './dto/reorder-stages.dto';
import { QueryStagesDto } from './dto/query-stages.dto';

@Controller('lead-stages')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LeadStagesController {
  constructor(private readonly service: LeadStagesService) {}

  @Get()
  list(@Query() query: QueryStagesDto, @CurrentUser() caller: AuthUser) {
    return this.service.list(caller, (query.includeHidden ?? false) && caller.role === Role.DIRECTOR);
  }

  @Post()
  @Roles(Role.DIRECTOR)
  create(@Body() dto: CreateStageDto, @CurrentUser() caller: AuthUser) {
    return this.service.create(dto, caller);
  }

  @Put('order')
  @Roles(Role.DIRECTOR)
  reorder(@Body() dto: ReorderStagesDto, @CurrentUser() caller: AuthUser) {
    return this.service.reorder(dto.keys, caller);
  }

  @Patch(':key')
  @Roles(Role.DIRECTOR)
  update(@Param('key') key: string, @Body() dto: UpdateStageDto, @CurrentUser() caller: AuthUser) {
    return this.service.update(key, dto, caller);
  }

  @Delete(':id')
  @Roles(Role.DIRECTOR)
  @HttpCode(204)
  remove(@Param('id') id: string, @CurrentUser() caller: AuthUser) {
    return this.service.remove(id, caller);
  }
}
