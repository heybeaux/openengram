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
  constructor(private readonly identityService: IdentityService) {}

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
}
