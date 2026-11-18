import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CoursesService } from './courses.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Role } from '@prisma/client';
import type { AuthUser } from '../../common/types/auth-user.type';
import { CreateCourseDto } from './dto/create-course.dto';
import { UpdateCourseDto } from './dto/update-course.dto';
import { AddBatchDto } from './dto/add-batch.dto';

@Controller('courses')
export class CoursesController {
  constructor(private courses: CoursesService) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  list(@Query('includeArchived') includeArchived: string | undefined, @CurrentUser() caller: AuthUser) {
    return this.courses.list(caller, includeArchived === 'true');
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DIRECTOR, Role.MANAGER)
  @Post()
  create(@Body() dto: CreateCourseDto, @CurrentUser() caller: AuthUser) {
    return this.courses.create(dto, caller);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DIRECTOR, Role.MANAGER)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCourseDto, @CurrentUser() caller: AuthUser) {
    return this.courses.update(id, dto, caller);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DIRECTOR, Role.MANAGER)
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() caller: AuthUser) {
    return this.courses.remove(id, caller);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DIRECTOR, Role.MANAGER)
  @Post(':id/batches')
  addBatch(@Param('id') id: string, @Body() dto: AddBatchDto, @CurrentUser() caller: AuthUser) {
    return this.courses.addBatch(id, dto, caller);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DIRECTOR, Role.MANAGER)
  @Delete(':id/batches/:batchId')
  removeBatch(@Param('id') id: string, @Param('batchId') batchId: string, @CurrentUser() caller: AuthUser) {
    return this.courses.removeBatch(id, batchId, caller);
  }
}
