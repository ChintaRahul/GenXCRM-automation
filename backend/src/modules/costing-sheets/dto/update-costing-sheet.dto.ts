import { PartialType } from '@nestjs/mapped-types';
import { CreateCostingSheetDto } from './create-costing-sheet.dto';

export class UpdateCostingSheetDto extends PartialType(CreateCostingSheetDto) {}
