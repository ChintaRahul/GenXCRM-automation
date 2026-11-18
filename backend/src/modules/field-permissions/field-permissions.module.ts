import { Module } from '@nestjs/common';
import { FieldPermissionsService } from './field-permissions.service';
import { FieldPermissionsAdapter } from './field-permissions.adapter';

@Module({
  providers: [FieldPermissionsService, FieldPermissionsAdapter],
  exports: [FieldPermissionsService],
})
export class FieldPermissionsModule {}
