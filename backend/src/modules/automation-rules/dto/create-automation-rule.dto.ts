import { IsIn, IsNotEmpty, IsString, Matches } from 'class-validator';
import { AUTOMATION_ACTION_PATTERN, AUTOMATION_TRIGGERS } from '../automation-engine.service';

export class CreateAutomationRuleDto {
  @IsIn(AUTOMATION_TRIGGERS) trigger: string;
  // "Always", or "Value >= 100000" (>=, >, <=, <).
  @IsString() @IsNotEmpty() condition: string;
  // "Notify owner", "Notify role: Sales Manager" or "Create task: Call the customer".
  @Matches(AUTOMATION_ACTION_PATTERN, { message: 'action must be "Notify owner", "Notify role: <role>" or "Create task: <subject>".' }) action: string;
}
