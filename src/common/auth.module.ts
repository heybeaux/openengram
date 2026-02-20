import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { ApiKeyOrJwtGuard } from './guards/api-key-or-jwt.guard';

@Global()
@Module({
  imports: [
    PrismaModule,
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET', 'engram-dev-secret-change-me'),
        signOptions: { expiresIn: '7d' },
      }),
    }),
  ],
  providers: [ApiKeyOrJwtGuard],
  exports: [ApiKeyOrJwtGuard, JwtModule],
})
export class AuthModule {}
