import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { FeedbackController } from './feedback.controller';
import { FeedbackService } from './feedback.service';
import { AccountJwtGuard } from '../account/account.guard';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get('JWT_SECRET', 'engram-dev-secret'),
      }),
    }),
  ],
  controllers: [FeedbackController],
  providers: [FeedbackService, AccountJwtGuard],
  exports: [FeedbackService],
})
export class FeedbackModule {}
