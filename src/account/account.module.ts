import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AccountController } from './account.controller.js';
import { AdminController } from './admin.controller.js';
import { AccountService } from './account.service.js';
import { AccountJwtGuard } from './account.guard.js';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET', 'engram-dev-secret-change-me'),
        signOptions: { expiresIn: '7d' },
      }),
    }),
  ],
  controllers: [AccountController, AdminController],
  providers: [AccountService, AccountJwtGuard],
  exports: [AccountService, JwtModule, AccountJwtGuard],
})
export class AccountModule {}
