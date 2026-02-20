import { Module } from '@nestjs/common';
import { IdentityController } from './identity.controller';
import { IdentityService } from './identity.service';
import { TaskOutcomeService } from './task-outcome.service';
import { SelfAssessmentService } from './self-assessment.service';
import { CapabilityProfileService } from './capability-profile.service';
import { WorkStyleService } from './work-style.service';
import { TrustSignalService } from './trust-signal.service';
import { TrustMemoryService } from './trust-memory.service';
import { FailurePatternService } from './failure-pattern.service';
import { PortableIdentityService } from './portable-identity.service';
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
    TrustSignalService,
    TrustMemoryService,
    FailurePatternService,
    PortableIdentityService,
  ],
  exports: [
    IdentityService,
    TaskOutcomeService,
    CapabilityProfileService,
    TrustSignalService,
    TrustMemoryService,
    FailurePatternService,
    PortableIdentityService,
  ],
})
export class IdentityModule {}
