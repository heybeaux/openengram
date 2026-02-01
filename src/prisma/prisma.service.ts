import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Soft delete helper - sets deletedAt instead of hard delete
   */
  async softDelete<T extends { deletedAt?: Date | null }>(
    model: { update: (args: any) => Promise<T> },
    where: object,
  ): Promise<T> {
    return model.update({
      where,
      data: { deletedAt: new Date() },
    });
  }
}
