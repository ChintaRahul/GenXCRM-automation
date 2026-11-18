import { Module } from '@nestjs/common';
import { ImportMappingsController } from './import-mappings.controller';
import { ImportMappingsService } from './import-mappings.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ImportMappingsController],
  providers: [ImportMappingsService],
  exports: [ImportMappingsService],
})
export class ImportMappingsModule {}
