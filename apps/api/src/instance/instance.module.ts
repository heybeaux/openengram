import { Module } from '@nestjs/common';
import { InstanceController } from './instance.controller';
import { InstanceService } from './instance.service';
import { AccountModule } from '../account/account.module';

@Module({
  imports: [AccountModule],
  controllers: [InstanceController],
  providers: [InstanceService],
  exports: [InstanceService],
})
export class InstanceModule {}
