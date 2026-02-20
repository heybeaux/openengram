import { Module } from '@nestjs/common';
import { IdentityController } from './identity.controller';
import { IdentityService } from './identity.service';
import { TaskOutcomeService } from './task-outcome.service';
import { SelfAssessmentService } from './self-assessment.service';
import { CapabilityProfileService } from './capability-profile.service';
import { WorkStyleService } from './work-style.service';
import { AccountModule } from '../account/account.module';

@Module({
  imports: [AccountModule],
  controllers: [IdentityController],
  providers: [
    IdentityService,
    TaskOutcomeService,
    SelfAssessmentService,
    CapabilityProfileService,
    WorkStyleService,
  ],
  exports: [IdentityService, TaskOutcomeService, CapabilityProfileService],
})
export class IdentityModule {}
