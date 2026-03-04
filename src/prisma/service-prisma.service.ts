import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * ServicePrismaService — a plain PrismaClient that bypasses RLS context.
 * Used by system-level services (e.g., Dream Cycle tracker) that need
 * unrestricted access across all users.
 */
@Injectable()
export class ServicePrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super();
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
