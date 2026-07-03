import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { VectorsService } from './vectors.service';
import { EmbeddingsService } from './embeddings.service';
import { PrismaModule } from '../prisma/prisma.module';

/**
 * Search module - bundles all search-related components.
 * 
 * Import this module in your AppModule:
 * 
 * @Module({
 *   imports: [
 *     ConfigModule.forRoot(),
 *     PrismaModule,
 *     SearchModule,
 *   ],
 * })
 * export class AppModule {}
 */
@Module({
  imports: [
    ConfigModule,
    PrismaModule,
  ],
  controllers: [SearchController],
  providers: [
    SearchService,
    VectorsService,
    EmbeddingsService,
  ],
  exports: [SearchService, VectorsService, EmbeddingsService],
})
export class SearchModule {}
