import { Injectable } from '@nestjs/common';
import { TaskOutcomeService } from './task-outcome.service';
import { SelfAssessmentService } from './self-assessment.service';
import { CapabilityProfileService } from './capability-profile.service';
import { WorkStyleService } from './work-style.service';
import {
  CreateTaskOutcomeDto,
  TaskOutcomeResponseDto,
  CreateSelfAssessmentDto,
  SelfAssessmentResponseDto,
  CapabilityProfileResponseDto,
  IdentityProfileResponseDto,
} from './dto/identity.dto';

/**
 * Orchestrates all identity profile features.
 * Coordinates between task outcomes, self-assessments, capability profiles,
 * and work style tracking.
 */
@Injectable()
export class IdentityService {
  constructor(
    private taskOutcome: TaskOutcomeService,
    private selfAssessment: SelfAssessmentService,
    private capabilityProfile: CapabilityProfileService,
    private workStyle: WorkStyleService,
  ) {}

  /**
   * Record a task outcome and cascade updates to capability profiles and work style
   */
  async recordTaskOutcome(
    userId: string,
    agentId: string,
    dto: CreateTaskOutcomeDto,
  ): Promise<TaskOutcomeResponseDto> {
    // 1. Create the task outcome memory
    const result = await this.taskOutcome.create(userId, agentId, dto);

    // 2. Update capability profiles if capabilities were specified
    if (dto.capabilitiesUsed?.length) {
      await this.capabilityProfile.updateFromTaskOutcome(agentId, userId, {
        capabilitiesUsed: dto.capabilitiesUsed,
        outcome: dto.outcome,
        durationMs: dto.durationMs,
        lessonsLearned: dto.lessonsLearned,
      });
    }

    // 3. Extract work style observations
    await this.workStyle.extractFromTaskOutcome(agentId, userId, {
      durationMs: dto.durationMs,
      capabilitiesUsed: dto.capabilitiesUsed,
      outcome: dto.outcome,
    });

    return result;
  }

  /**
   * Record a self-assessment
   */
  async recordSelfAssessment(
    userId: string,
    agentId: string,
    dto: CreateSelfAssessmentDto,
  ): Promise<SelfAssessmentResponseDto> {
    return this.selfAssessment.create(userId, agentId, dto);
  }

  /**
   * Get the full identity profile for an agent
   */
  async getIdentityProfile(
    agentId: string,
    userId: string,
  ): Promise<IdentityProfileResponseDto> {
    const [capabilities, workStyleDims, selfAssessments, recentOutcomes] =
      await Promise.all([
        this.capabilityProfile.getProfile(agentId, userId),
        this.workStyle.getWorkStyle(agentId, userId),
        this.selfAssessment.getLatestByArea(userId, agentId),
        this.taskOutcome.list(userId, agentId, 20),
      ]);

    return {
      agentId,
      capabilities: capabilities.capabilities,
      workStyle: workStyleDims,
      selfAssessments,
      recentOutcomes,
    };
  }

  /**
   * Get capability profile only
   */
  async getCapabilities(
    agentId: string,
    userId: string,
  ): Promise<CapabilityProfileResponseDto> {
    return this.capabilityProfile.getProfile(agentId, userId);
  }
}
