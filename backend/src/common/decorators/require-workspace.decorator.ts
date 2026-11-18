import { SetMetadata } from '@nestjs/common';
import { WorkspaceType } from '@prisma/client';

export const WORKSPACE_KEY = 'workspaceTypes';
export const RequireWorkspace = (...types: WorkspaceType[]) => SetMetadata(WORKSPACE_KEY, types);
