import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ChallengeService } from './challenge.service';
import { CreateChallengeDto, ResolveChallengeDto, ChallengeResponseDto } from './dto/challenge.dto';
import { ApiKeyOrJwtGuard } from '../common/guards/api-key-or-jwt.guard';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard';
import { SanitizeInterceptor } from '../common/interceptors/sanitize.interceptor';
import { UserId } from '../common/decorators/user-id.decorator';
import { ChallengeStatus } from './challenge.types';

@ApiTags('challenges')
@Controller('v1')
@UseGuards(ApiKeyOrJwtGuard, RateLimitGuard)
@UseInterceptors(SanitizeInterceptor)
export class ChallengeController {
  constructor(private readonly challengeService: ChallengeService) {}

  /**
   * POST /v1/memories/:id/challenge
   * Challenge a memory with evidence
   */
  @Post('memories/:id/challenge')
  @ApiOperation({ summary: 'Challenge a memory' })
  @ApiResponse({ status: 201, description: 'Challenge created.' })
  async createChallenge(
    @UserId() userId: string,
    @Param('id') memoryId: string,
    @Body() dto: CreateChallengeDto,
  ): Promise<ChallengeResponseDto> {
    return this.challengeService.createChallenge(userId, memoryId, {
      challengerId: dto.challengerId,
      memoryId,
      reason: dto.reason,
      evidence: dto.evidence,
    });
  }

  /**
   * GET /v1/challenges
   * List all challenges
   */
  @Get('challenges')
  @ApiOperation({ summary: 'List challenges' })
  async listChallenges(
    @UserId() userId: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<ChallengeResponseDto[]> {
    return this.challengeService.listChallenges(userId, {
      status: status as ChallengeStatus | undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  /**
   * GET /v1/challenges/:id
   * Get a specific challenge
   */
  @Get('challenges/:id')
  @ApiOperation({ summary: 'Get a challenge' })
  async getChallenge(
    @UserId() userId: string,
    @Param('id') challengeId: string,
  ): Promise<ChallengeResponseDto> {
    return this.challengeService.getChallenge(userId, challengeId);
  }

  /**
   * PATCH /v1/challenges/:id/resolve
   * Resolve a challenge
   */
  @Patch('challenges/:id/resolve')
  @ApiOperation({ summary: 'Resolve a challenge' })
  async resolveChallenge(
    @UserId() userId: string,
    @Param('id') challengeId: string,
    @Body() dto: ResolveChallengeDto,
  ): Promise<ChallengeResponseDto> {
    return this.challengeService.resolveChallenge(userId, challengeId, {
      status: dto.status,
      resolution: dto.resolution,
      method: dto.method,
      resolvedBy: dto.resolvedBy,
    });
  }
}
