import { Module } from '@nestjs/common';
import { CloudLinkController } from './cloud-link.controller';
import { CloudLinkService } from './cloud-link.service';
import { AccountModule } from '../account/account.module';

@Module({
  imports: [AccountModule],
  controllers: [CloudLinkController],
  providers: [CloudLinkService],
  exports: [CloudLinkService],
})
export class CloudLinkModule {}
