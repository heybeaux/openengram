import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { EmbeddingModule } from '../embedding/embedding.module';
import { IdentityController } from './identity.controller';
import { AgentsAliasController } from './agents-alias.controller';
import { DelegationContractController } from './delegation-contract.controller';
import { ChallengeController, MemoryChallengeController } from './challenge.controller';
import { TeamController } from './team.controller';
import { DelegationContractService } from './delegation-contract.service';
import { ChallengeService } from './challenge.service';
import { FailurePatternService } from './failure-pattern.service';
import { TeamProfileService } from './team-profile.service';
import { DelegationRecallService } from './delegation-recall.service';
import { PortableIdentityService } from './portable-identity.service';
import { TaskCompletionService } from './task-completion.service';
import { DelegationTemplateService } from './delegation-template.service';
import { TrustProfileService } from './trust-profile.service';

@Module({
  imports: [
    PrismaModule,
    EmbeddingModule,
  ],
  controllers: [
    IdentityController,
    AgentsAliasController,
    DelegationContractController,
    ChallengeController,
    MemoryChallengeController,
    TeamController,
  ],
  providers: [
    IdentityController,
    DelegationContractService,
    ChallengeService,
    FailurePatternService,
    TeamProfileService,
    DelegationRecallService,
    PortableIdentityService,
    TaskCompletionService,
    DelegationTemplateService,
    TrustProfileService,
  ],
  exports: [
    DelegationContractService,
    ChallengeService,
    FailurePatternService,
    TeamProfileService,
    DelegationRecallService,
    PortableIdentityService,
    TaskCompletionService,
    DelegationTemplateService,
    TrustProfileService,
  ],
})
export class IdentityModule implements OnModuleInit {
  private readonly logger = new Logger(IdentityModule.name);

  constructor(
    private readonly contractService: DelegationContractService,
    private readonly challengeService: ChallengeService,
  ) {}

  onModuleInit() {
    this.contractService.setChallengeService(this.challengeService);
    this.logger.log('Identity module initialized — all identity services active');
  }
}
