import { IsIn, IsNotEmpty, IsString } from 'class-validator';

const ENTITY_TYPES = ['Lead', 'Opportunity', 'Rfq', 'SiteVisit', 'Evaluation', 'CostingSheet', 'Quotation', 'Approval', 'PurchaseOrder', 'SalesOrder', 'Dispatch', 'PaymentMilestone', 'ServiceTicket', 'Coverage'];

export class CreateSlaTimerDto {
  @IsString() @IsNotEmpty() slaPolicyId: string;
  @IsIn(ENTITY_TYPES) entityType: string;
  @IsString() @IsNotEmpty() entityId: string;
}
