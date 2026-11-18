import { Module } from '@nestjs/common';
import { ProductsService } from './products.service';
import { ProductsAdapter } from './products.adapter';

@Module({
  providers: [ProductsService, ProductsAdapter],
  exports: [ProductsService],
})
export class ProductsModule {}
