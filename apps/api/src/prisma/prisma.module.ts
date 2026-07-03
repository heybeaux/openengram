import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { PrismaService } from './prisma.service';
import { RlsInterceptor } from './rls.interceptor';

@Global()
@Module({
  providers: [
    PrismaService,
    {
      provide: APP_INTERCEPTOR,
      useClass: RlsInterceptor,
    },
  ],
  exports: [PrismaService],
})
export class PrismaModule {}
