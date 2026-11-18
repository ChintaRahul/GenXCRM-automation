import { IsInt, Min } from 'class-validator';

export class UpdateSeatsDto {
  @IsInt()
  @Min(1)
  userCount!: number;
}
