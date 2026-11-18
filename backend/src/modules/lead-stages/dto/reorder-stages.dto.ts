import { ArrayMinSize, ArrayUnique, IsArray, IsString } from 'class-validator';

export class ReorderStagesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsString({ each: true })
  readonly keys!: string[];
}
