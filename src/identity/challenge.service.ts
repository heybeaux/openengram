import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  Challenge,
  CreateChallengeDto,
  ResolveChallengeDto,
  AgentCapabilityProfile,
  DelegationContract,
} from './identity.types';
import { PrismaService } from '../prisma/prisma.service';

/**
 * ChallengeService (HEY-186)
 *
 * Formal mechanism for agents to push back on unsafe or underspecified tasks.
 * When a delegation contract is created, auto-checks agent capability profile
 * and raises a challenge if confidence is below threshold.
 *
 * Challenges and agent profiles are persisted to PostgreSQL via Prisma (HEY-385).
 */
@Injectable()
export class ChallengeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChallengeService.name);
  private challenges = new Map<string, Challenge>();
  private agentProfiles = new Map<string, AgentCapabilityProfile>();

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    try {
      const challengeRows = await this.prisma.identityChallenge.findMany();
      for (const row of challengeRows) {
        this.challenges.set(row.id, {
          id: row.id,
          contractId: row.contractId ?? undefined,
          taskDescription: row.taskDescription,
          challengeType: row.challengeType as Challenge['challengeType'],
          reasoning: row.reasoning,
          resolution: (row.resolution as Challenge['resolution']) ?? undefined,
          resolvedBy: row.resolvedBy ?? undefined,
          resolvedAt: row.resolvedAt ?? undefined,
          createdAt: row.createdAt,
          accountId: row.accountId ?? undefined,
        });
      }
      if (this.challenges.size > 0) {
        this.logger.log(
          `Loaded ${this.challenges.size} challenges from database`,
        );
      }

      const profileRows = await this.prisma.identityAgentProfile.findMany();
      for (const row of profileRows) {
        this.agentProfiles.set(row.agentId, {
          agentId: row.agentId,
          domains: row.domains,
          confidenceByDomain: row.confidenceByDomain as Record<string, number>,
        });
      }
      if (this.agentProfiles.size > 0) {
        this.logger.log(
          `Loaded ${this.agentProfiles.size} agent profiles from database`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Failed to load challenges/profiles from database: ${err}`,
      );
    }
  }

  onModuleDestroy(): void {
    // No-op — all writes are persisted immediately
    this.logger.log(
      'ChallengeService: shutdown complete (data persisted to database)',
    );
  }

  private persistChallenge(challenge: Challenge): void {
    this.prisma.identityChallenge
      .upsert({
        where: { id: challenge.id },
        create: {
          id: challenge.id,
          contractId: challenge.contractId ?? null,
          taskDescription: challenge.taskDescription,
          challengeType: challenge.challengeType,
          reasoning: challenge.reasoning,
          resolution: challenge.resolution ?? null,
          resolvedBy: challenge.resolvedBy ?? null,
          resolvedAt: challenge.resolvedAt ?? null,
          accountId: challenge.accountId ?? null,
          createdAt: challenge.createdAt,
        },
        update: {
          resolution: challenge.resolution ?? null,
          resolvedBy: challenge.resolvedBy ?? null,
          resolvedAt: challenge.resolvedAt ?? null,
        },
      })
      .catch((err) =>
        this.logger.warn(`Failed to persist challenge: ${err.message}`),
      );
  }

  private persistProfile(profile: AgentCapabilityProfile): void {
    this.prisma.identityAgentProfile
      .upsert({
        where: { agentId: profile.agentId },
        create: {
          agentId: profile.agentId,
          domains: profile.domains,
          confidenceByDomain: profile.confidenceByDomain,
        },
        update: {
          domains: profile.domains,
          confidenceByDomain: profile.confidenceByDomain,
        },
      })
      .catch((err) =>
        this.logger.warn(`Failed to persist agent profile: ${err.message}`),
      );
  }

  static readonly CONFIDENCE_THRESHOLD = 0.3;

  registerAgentProfile(profile: AgentCapabilityProfile): void {
    this.agentProfiles.set(profile.agentId, profile);
    this.persistProfile(profile);
  }

  getAgentProfile(agentId: string): AgentCapabilityProfile | undefined {
    return this.agentProfiles.get(agentId);
  }

  async create(dto: CreateChallengeDto): Promise<Challenge> {
    const challenge: Challenge = {
      id: randomUUID(),
      contractId: dto.contractId,
      taskDescription: dto.taskDescription,
      challengeType: dto.challengeType,
      reasoning: dto.reasoning,
      createdAt: new Date(),
      accountId: dto.accountId,
    };

    this.challenges.set(challenge.id, challenge);
    this.persistChallenge(challenge);
    this.logger.log(
      `Challenge ${challenge.id} raised: ${challenge.challengeType}`,
    );
    return challenge;
  }

  getById(id: string): Challenge {
    const challenge = this.challenges.get(id);
    if (!challenge) throw new NotFoundException(`Challenge ${id} not found`);
    return challenge;
  }

  listAll(filters?: { contractId?: string }): Challenge[] {
    let results = Array.from(this.challenges.values());
    if (filters?.contractId) {
      results = results.filter((c) => c.contractId === filters.contractId);
    }
    return results;
  }

  async resolve(id: string, dto: ResolveChallengeDto): Promise<Challenge> {
    const challenge = this.getById(id);
    if (challenge.resolution) {
      throw new Error(
        `Challenge ${id} already resolved: ${challenge.resolution}`,
      );
    }

    challenge.resolution = dto.resolution;
    challenge.resolvedBy = dto.resolvedBy;
    challenge.resolvedAt = new Date();
    this.persistChallenge(challenge);

    this.logger.log(
      `Challenge ${id} resolved: ${dto.resolution} by ${dto.resolvedBy}`,
    );
    return challenge;
  }

  /**
   * Auto-check: when a delegation contract is created, check if the agent
   * has sufficient capability confidence. If below threshold, auto-raise a challenge.
   */
  async autoCheckCapability(
    contract: DelegationContract,
  ): Promise<Challenge | null> {
    const profile = this.agentProfiles.get(contract.delegatedTo);
    if (!profile) return null; // No profile registered — skip check

    // Extract domain keywords from task description
    const taskWords = contract.taskDescription.toLowerCase().split(/\s+/);
    let lowestConfidence = 1.0;
    let matchedDomain: string | undefined;

    for (const domain of profile.domains) {
      const domainLower = domain.toLowerCase();
      if (
        taskWords.some(
          (w) => domainLower.includes(w) || w.includes(domainLower),
        )
      ) {
        const confidence = profile.confidenceByDomain[domain] ?? 1.0;
        if (confidence < lowestConfidence) {
          lowestConfidence = confidence;
          matchedDomain = domain;
        }
      }
    }

    if (
      lowestConfidence < ChallengeService.CONFIDENCE_THRESHOLD &&
      matchedDomain
    ) {
      const challenge = await this.create({
        contractId: contract.id,
        taskDescription: contract.taskDescription,
        challengeType: 'capability_mismatch',
        reasoning: `Agent ${contract.delegatedTo} has low confidence (${lowestConfidence}) in domain "${matchedDomain}"`,
        accountId: contract.accountId,
      });
      this.logger.warn(
        `Auto-challenge raised for contract ${contract.id}: capability_mismatch in "${matchedDomain}"`,
      );
      return challenge;
    }

    return null;
  }
}
