/**
 * Storage Module
 *
 * Provides a unified storage interface via StorageService.
 * Provider is selected by STORAGE_PROVIDER env var (default: 'prisma-postgres').
 *
 * Global module — available to all other modules without explicit import.
 */

import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageService } from './storage.service';
import { PrismaPostgresProvider } from './prisma-postgres.provider';
import { SqliteProvider } from './sqlite.provider';

@Global()
@Module({
  imports: [ConfigModule, PrismaModule],
  providers: [PrismaPostgresProvider, SqliteProvider, StorageService],
  exports: [StorageService],
})
export class StorageModule {}
