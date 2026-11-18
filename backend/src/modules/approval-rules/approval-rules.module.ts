import { Module } from '@nestjs/common';
import { ApprovalRulesService } from './approval-rules.service';
import { ApprovalRulesAdapter } from './approval-rules.adapter';

@Module({
  providers: [ApprovalRulesService, ApprovalRulesAdapter],
  exports: [ApprovalRulesService],
})
export class ApprovalRulesModule {}
