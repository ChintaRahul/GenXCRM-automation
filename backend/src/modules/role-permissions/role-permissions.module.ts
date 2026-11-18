import { Module } from '@nestjs/common';
import { RolePermissionsService } from './role-permissions.service';
import { RolePermissionsAdapter } from './role-permissions.adapter';

@Module({
  providers: [RolePermissionsService, RolePermissionsAdapter],
  exports: [RolePermissionsService],
})
export class RolePermissionsModule {}
