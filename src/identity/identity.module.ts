import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { IdentityController } from './identity.controller';
import { DelegationContractService } from './delegation-contract.service';
import { ChallengeService } from './challenge.service';
import { FailurePatternService } from './failure-pattern.service';

/**
 * Identity Module — Agent identity framework
 *
 * Provides:
 * - Delegation Contracts (HEY-185): verification criteria before spawning sub-agents
 * - Challenge Protocol (HEY-186): agents can push back on unsafe/underspecified tasks
 * - Failure Pattern Detection (HEY-187): flags recurring delegation failures
 *
 * Migration needs (not yet applied):
 * - DelegationContract model for persistent contract storage
 * - Challenge model for persistent challenge storage
 * - FailurePattern model for persistent pattern storage
 * Currently uses in-memory storage; data is lost on restart.
 */
@Module({
  controllers: [IdentityController],
  providers: [DelegationContractService, ChallengeService, FailurePatternService],
  exports: [DelegationContractService, ChallengeService, FailurePatternService],
})
export class IdentityModule implements OnModuleInit {
  private readonly logger = new Logger(IdentityModule.name);

  constructor(
    private readonly contractService: DelegationContractService,
    private readonly challengeService: ChallengeService,
  ) {}

  onModuleInit() {
    // Wire up cross-service dependencies
    this.contractService.setChallengeService(this.challengeService);
    this.logger.log('Identity module initialized — Delegation Contracts, Challenge Protocol, Failure Patterns active');
  }
}
