import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { EmbeddingModule } from '../embedding/embedding.module';
import { IdentityController } from './identity.controller';
import { DelegationContractService } from './delegation-contract.service';
import { ChallengeService } from './challenge.service';
import { FailurePatternService } from './failure-pattern.service';
import { TeamProfileService } from './team-profile.service';
import { DelegationRecallService } from './delegation-recall.service';
import { PortableIdentityService } from './portable-identity.service';
import { TaskCompletionService } from './task-completion.service';
import { DelegationTemplateService } from './delegation-template.service';
import { TrustProfileService } from './trust-profile.service';

/**
 * Identity Module — Agent identity framework
 *
 * Provides:
 * - Delegation Contracts (HEY-185): verification criteria before spawning sub-agents
 * - Challenge Protocol (HEY-186): agents can push back on unsafe/underspecified tasks
 * - Failure Pattern Detection (HEY-187): flags recurring delegation failures
 * - Team Profiles (HEY-188): team capability aggregation
 * - Delegation-Aware Recall (HEY-189): recall with delegation context
 * - Portable Agent Identity (HEY-190): export/import agent identities
 * - Task Completion Tracking (HEY-182): structured delegation outcome records
 * - Delegation Templates (HEY-183): pattern-based suggestions from history
 * - Trust Profiles (HEY-184): domain-specific trust scores with recency decay
 */
@Module({
  imports: [
    PrismaModule,
    EmbeddingModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET', 'engram-dev-secret-change-me'),
        signOptions: { expiresIn: '7d' },
      }),
    }),
  ],
  controllers: [IdentityController],
  providers: [
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
