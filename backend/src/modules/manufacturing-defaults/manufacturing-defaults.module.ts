import { Module } from '@nestjs/common';
import { ManufacturingDefaultsService } from './manufacturing-defaults.service';

@Module({
  providers: [ManufacturingDefaultsService],
  exports: [ManufacturingDefaultsService],
})
export class ManufacturingDefaultsModule {}
