import { Global, Module } from '@nestjs/common';
import { VectorService } from './vector.service';
import { PgVectorProvider } from './providers/pgvector.provider';
import { PineconeProvider } from './providers/pinecone.provider';

@Global()
@Module({
  providers: [VectorService, PgVectorProvider, PineconeProvider],
  exports: [VectorService],
})
export class VectorModule {}
