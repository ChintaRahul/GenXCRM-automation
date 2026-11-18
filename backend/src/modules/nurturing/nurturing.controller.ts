import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { NurturingService } from './nurturing.service';
import { CreateSequenceDto } from './dto/create-sequence.dto';
import { UpdateSequenceDto } from './dto/update-sequence.dto';
import { CreateStepDto } from './dto/create-step.dto';
import { EnrollLeadDto } from './dto/enroll-lead.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/types/auth-user.type';

@UseGuards(JwtAuthGuard)
@Controller('nurturing')
export class NurturingController {
  constructor(private readonly nurturing: NurturingService) {}

  @Get('sequences')
  findAll(@CurrentUser() caller: AuthUser) {
    return this.nurturing.findAll(caller);
  }

  @Post('sequences')
  create(@Body() dto: CreateSequenceDto, @CurrentUser() caller: AuthUser) {
    return this.nurturing.create(dto, caller);
  }

  @Get('sequences/:id')
  findOne(@Param('id') id: string, @CurrentUser() caller: AuthUser) {
    return this.nurturing.findOne(id, caller);
  }

  @Get('sequences/:id/enrollments')
  getEnrollments(
    @Param('id') id: string,
    @Query('page') page: string | undefined,
    @Query('limit') limit: string | undefined,
    @CurrentUser() caller: AuthUser,
  ) {
    return this.nurturing.getEnrollments(id, caller, page ? Number(page) : undefined, limit ? Number(limit) : undefined);
  }

  @Patch('sequences/:id')
  update(@Param('id') id: string, @Body() dto: UpdateSequenceDto, @CurrentUser() caller: AuthUser) {
    return this.nurturing.update(id, dto, caller);
  }

  @Delete('sequences/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @CurrentUser() caller: AuthUser) {
    return this.nurturing.remove(id, caller);
  }

  @Post('sequences/:id/steps')
  addStep(@Param('id') sequenceId: string, @Body() dto: CreateStepDto, @CurrentUser() caller: AuthUser) {
    return this.nurturing.addStep(sequenceId, dto, caller);
  }

  @Patch('steps/:stepId')
  updateStep(
    @Param('stepId') stepId: string,
    @Body() dto: Partial<CreateStepDto>,
    @CurrentUser() caller: AuthUser,
  ) {
    return this.nurturing.updateStep(stepId, dto, caller);
  }

  @Delete('steps/:stepId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeStep(@Param('stepId') stepId: string) {
    return this.nurturing.removeStep(stepId);
  }

  @Post('sequences/:id/enroll')
  enrollLead(@Param('id') sequenceId: string, @Body() dto: EnrollLeadDto, @CurrentUser() caller: AuthUser) {
    return this.nurturing.enrollLead(sequenceId, dto.leadId, caller);
  }

  @Delete('enrollments/:eid')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeEnrollment(@Param('eid') eid: string, @CurrentUser() caller: AuthUser) {
    return this.nurturing.removeEnrollment(eid, caller);
  }
}
