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
import { FileStoreService } from '../common/persistence/file-store.service';

const CHALLENGES_FILE = 'challenges.json';
const AGENT_PROFILES_FILE = 'agent-profiles.json';

/**
 * ChallengeService (HEY-186)
 *
 * Formal mechanism for agents to push back on unsafe or underspecified tasks.
 * When a delegation contract is created, auto-checks agent capability profile
 * and raises a challenge if confidence is below threshold.
 *
 * Challenges and agent profiles are persisted to disk via FileStoreService (HEY-346).
 */
@Injectable()
export class ChallengeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChallengeService.name);
  private challenges = new Map<string, Challenge>();
  private agentProfiles = new Map<string, AgentCapabilityProfile>();

  constructor(private readonly fileStore: FileStoreService) {}

  onModuleInit(): void {
    this.challenges = this.fileStore.load<string, Challenge>(CHALLENGES_FILE);
    this.agentProfiles = this.fileStore.load<string, AgentCapabilityProfile>(
      AGENT_PROFILES_FILE,
    );
    if (this.challenges.size > 0) {
      this.logger.log(`Loaded ${this.challenges.size} challenges from disk`);
    }
    if (this.agentProfiles.size > 0) {
      this.logger.log(
        `Loaded ${this.agentProfiles.size} agent profiles from disk`,
      );
    }
  }

  onModuleDestroy(): void {
    this.persistChallenges();
    this.persistProfiles();
    this.logger.log(
      'ChallengeService: persisted challenges and profiles on shutdown',
    );
  }

  private persistChallenges(): void {
    this.fileStore
      .save(CHALLENGES_FILE, this.challenges)
      .catch((err) =>
        this.logger.warn(`Failed to persist challenges: ${err.message}`),
      );
  }

  private persistProfiles(): void {
    this.fileStore
      .save(AGENT_PROFILES_FILE, this.agentProfiles)
      .catch((err) =>
        this.logger.warn(`Failed to persist agent profiles: ${err.message}`),
      );
  }

  static readonly CONFIDENCE_THRESHOLD = 0.3;

  registerAgentProfile(profile: AgentCapabilityProfile): void {
    this.agentProfiles.set(profile.agentId, profile);
    this.persistProfiles();
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
    this.persistChallenges();
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
    this.persistChallenges();

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
