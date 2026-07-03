import { Global, Module } from '@nestjs/common';
import { FileStoreService } from './file-store.service';

/**
 * PersistenceModule (HEY-346)
 *
 * Provides FileStoreService globally so any module can inject it
 * for file-based persistence of in-memory Maps.
 */
@Global()
@Module({
  providers: [FileStoreService],
  exports: [FileStoreService],
})
export class PersistenceModule {}
