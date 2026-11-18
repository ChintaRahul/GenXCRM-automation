import { Injectable } from '@nestjs/common';
import type { ModuleAdapter, ModuleListQuery, ModulePaginatedResult } from '../../modules-framework/module-adapter.interface';
import { ModuleRegistryService } from '../../modules-framework/module-registry.service';
import { validateBody } from '../../modules-framework/utils/validate-body.util';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import type { AuthUser } from '../../common/types/auth-user.type';

@Injectable()
export class ProductsAdapter implements ModuleAdapter {
  constructor(private readonly products: ProductsService, registry: ModuleRegistryService) {
    registry.register('products', this);
  }

  list(query: ModuleListQuery, caller: AuthUser): Promise<ModulePaginatedResult<Record<string, unknown>>> {
    return this.products.findAll(query, caller);
  }

  getFacets(query: ModuleListQuery, caller: AuthUser) {
    return this.products.getFacets(query, caller);
  }

  findOne(id: string, caller: AuthUser) {
    return this.products.findOne(id, caller);
  }

  async create(dto: Record<string, unknown>, caller: AuthUser) {
    return this.products.create(await validateBody(CreateProductDto, dto), caller);
  }

  async update(id: string, dto: Record<string, unknown>, caller: AuthUser) {
    return this.products.update(id, await validateBody(UpdateProductDto, dto), caller);
  }

  archive(id: string, caller: AuthUser) {
    return this.products.archive(id, caller);
  }

  performAction(id: string, action: string, payload: Record<string, unknown> | undefined, caller: AuthUser) {
    return this.products.performAction(id, action, payload, caller);
  }
}
