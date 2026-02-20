import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { IdentityService } from './identity.service';
import { PortableIdentityService } from './portable-identity.service';
import { TrustMemoryService } from './trust-memory.service';
import { FailurePatternService } from './failure-pattern.service';
import {
  CreateTaskOutcomeDto,
  CreateSelfAssessmentDto,
  TaskOutcomeResponseDto,
  SelfAssessmentResponseDto,
  CapabilityProfileResponseDto,
  IdentityProfileResponseDto,
} from './dto/identity.dto';
import { ApiKeyOrJwtGuard } from '../common/guards/api-key-or-jwt.guard';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard';
import { SanitizeInterceptor } from '../common/interceptors/sanitize.interceptor';
import { UserId } from '../common/decorators/user-id.decorator';

@ApiTags('identity')
@Controller('v1')
@UseGuards(ApiKeyOrJwtGuard, RateLimitGuard)
@UseInterceptors(SanitizeInterceptor)
export class IdentityController {
  constructor(
    private readonly identityService: IdentityService,
    private readonly portableIdentity: PortableIdentityService,
    private readonly trustMemory: TrustMemoryService,
    private readonly failurePattern: FailurePatternService,
  ) {}

  // ── HEY-177: Task Outcomes ──────────────────────────────────────────

  /**
   * POST /v1/agents/:agentId/task-outcomes
   * Record a task outcome with structured metadata
   */
  @Post('agents/:agentId/task-outcomes')
  @ApiOperation({ summary: 'Record a task outcome' })
  @ApiResponse({ status: 201, description: 'Task outcome recorded.' })
  async recordTaskOutcome(
    @UserId() userId: string,
    @Param('agentId') agentId: string,
    @Body() dto: CreateTaskOutcomeDto,
  ): Promise<TaskOutcomeResponseDto> {
    return this.identityService.recordTaskOutcome(userId, agentId, dto);
  }

  /**
   * GET /v1/agents/:agentId/task-outcomes
   * List task outcomes for an agent
   */
  @Get('agents/:agentId/task-outcomes')
  @ApiOperation({ summary: 'List task outcomes' })
  async listTaskOutcomes(
    @UserId() userId: string,
    @Param('agentId') agentId: string,
    @Query('limit') limit?: string,
  ): Promise<TaskOutcomeResponseDto[]> {
    return this.identityService['taskOutcome'].list(
      userId,
      agentId,
      limit ? parseInt(limit, 10) : 50,
    );
  }

  // ── HEY-180: Self-Assessments ───────────────────────────────────────

  /**
   * POST /v1/agents/:agentId/self-assessments
   * Record a self-assessment
   */
  @Post('agents/:agentId/self-assessments')
  @ApiOperation({ summary: 'Record a self-assessment' })
  @ApiResponse({ status: 201, description: 'Self-assessment recorded.' })
  async recordSelfAssessment(
    @UserId() userId: string,
    @Param('agentId') agentId: string,
    @Body() dto: CreateSelfAssessmentDto,
  ): Promise<SelfAssessmentResponseDto> {
    return this.identityService.recordSelfAssessment(userId, agentId, dto);
  }

  /**
   * GET /v1/agents/:agentId/self-assessments
   * List self-assessments
   */
  @Get('agents/:agentId/self-assessments')
  @ApiOperation({ summary: 'List self-assessments' })
  async listSelfAssessments(
    @UserId() userId: string,
    @Param('agentId') agentId: string,
    @Query('area') area?: string,
  ): Promise<SelfAssessmentResponseDto[]> {
    return this.identityService['selfAssessment'].list(userId, agentId, {
      area,
    });
  }

  // ── HEY-179: Capability Profiles ───────────────────────────────────

  /**
   * GET /v1/agents/:id/capabilities
   * Get the capability profile for an agent
   */
  @Get('agents/:id/capabilities')
  @ApiOperation({ summary: 'Get agent capability profile' })
  async getCapabilities(
    @UserId() userId: string,
    @Param('id') agentId: string,
  ): Promise<CapabilityProfileResponseDto> {
    return this.identityService.getCapabilities(agentId, userId);
  }

  // ── Full Identity Profile ──────────────────────────────────────────

  /**
   * GET /v1/agents/:id/identity
   * Get the full identity profile (capabilities + work style + assessments + outcomes)
   */
  @Get('agents/:id/identity')
  @ApiOperation({ summary: 'Get full agent identity profile' })
  async getIdentityProfile(
    @UserId() userId: string,
    @Param('id') agentId: string,
  ): Promise<IdentityProfileResponseDto> {
    return this.identityService.getIdentityProfile(agentId, userId);
  }

  // ── HEY-190: Portable Agent Identity ───────────────────────────────

  /**
   * GET /v1/agents/:id/export
   * Export agent identity as a portable JSON bundle
   */
  @Get('agents/:id/export')
  @ApiOperation({ summary: 'Export agent identity bundle' })
  async exportAgent(
    @UserId() userId: string,
    @Param('id') agentId: string,
  ) {
    return this.portableIdentity.exportAgent(userId, agentId);
  }

  /**
   * POST /v1/agents/:id/import
   * Import an agent identity bundle
   */
  @Post('agents/:id/import')
  @ApiOperation({ summary: 'Import agent identity bundle' })
  async importAgent(
    @UserId() userId: string,
    @Param('id') agentId: string,
    @Body() bundle: any,
  ) {
    return this.portableIdentity.importAgent(userId, agentId, bundle);
  }

  // ── HEY-184: Trust Scores as Living Memory ─────────────────────────

  /**
   * POST /v1/agents/:agentId/trust/recompute
   * Recompute trust score and store as living memory
   */
  @Post('agents/:agentId/trust/recompute')
  @ApiOperation({ summary: 'Recompute trust score and create trust memory' })
  @ApiResponse({ status: 201, description: 'Trust score recomputed and memory created.' })
  async recomputeTrust(
    @UserId() userId: string,
    @Param('agentId') agentId: string,
    @Query('category') category?: string,
  ) {
    return this.trustMemory.recomputeAndRemember(userId, { agentId, category });
  }

  /**
   * GET /v1/agents/:agentId/trust/narrative
   * Get the living trust narrative
   */
  @Get('agents/:agentId/trust/narrative')
  @ApiOperation({ summary: 'Get trust score narrative history' })
  async getTrustNarrative(
    @UserId() userId: string,
    @Param('agentId') agentId: string,
    @Query('category') category?: string,
    @Query('limit') limit?: string,
  ) {
    return this.trustMemory.getTrustNarrative(userId, {
      agentId,
      category,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  // ── HEY-187: Failure Pattern Detection ─────────────────────────────

  /**
   * GET /v1/agents/:agentId/failure-patterns
   * Analyze and return failure patterns
   */
  @Get('agents/:agentId/failure-patterns')
  @ApiOperation({ summary: 'Detect failure patterns for an agent' })
  async getFailurePatterns(
    @UserId() userId: string,
    @Param('agentId') agentId: string,
    @Query('storeInsights') storeInsights?: string,
  ) {
    return this.failurePattern.analyze(userId, {
      agentId,
      storeInsights: storeInsights !== 'false',
    });
  }
}
