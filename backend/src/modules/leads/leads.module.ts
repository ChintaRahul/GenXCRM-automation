import { Module } from '@nestjs/common';
import { LeadsService } from './leads.service';
import { LeadsController } from './leads.controller';
import { AssignmentsModule } from '../assignments/assignments.module';
import { NurturingModule } from '../nurturing/nurturing.module';
import { CoursesModule } from '../courses/courses.module';

@Module({
  imports: [AssignmentsModule, NurturingModule, CoursesModule],
  providers: [LeadsService],
  controllers: [LeadsController],
  exports: [LeadsService],
})
export class LeadsModule {}
