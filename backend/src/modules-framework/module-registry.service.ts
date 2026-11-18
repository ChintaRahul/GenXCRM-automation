import { Injectable, NotFoundException } from '@nestjs/common';
import type { ModuleAdapter } from './module-adapter.interface';

@Injectable()
export class ModuleRegistryService {
  private readonly adapters = new Map<string, ModuleAdapter>();

  register(moduleKey: string, adapter: ModuleAdapter): void {
    this.adapters.set(moduleKey, adapter);
  }

  resolve(moduleKey: string): ModuleAdapter {
    const adapter = this.adapters.get(moduleKey);
    if (!adapter) throw new NotFoundException(`Module '${moduleKey}' is not available.`);
    return adapter;
  }
}
