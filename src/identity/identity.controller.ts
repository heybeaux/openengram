import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiQuery } from '@nestjs/swagger';
import { ApiKeyOrJwtGuard } from '../common/guards/api-key-or-jwt.guard';
import { TeamProfileService } from './team-profile.service';
import { DelegationRecallService } from './delegation-recall.service';
import { PortableIdentityService } from './portable-identity.service';
import { TaskCompletionService } from './task-completion.service';
import { DelegationTemplateService } from './delegation-template.service';
import { TrustProfileService } from './trust-profile.service';
import { CreateTeamDto } from './dto/team.dto';
import { ImportIdentityDto } from './dto/portable-identity.dto';
import {
  CreateTaskCompletionDto,
  QueryTaskCompletionsDto,
} from './dto/task-completion.dto';

@ApiTags('identity')
@UseGuards(ApiKeyOrJwtGuard)
@Controller('v1/identity')
export class IdentityController {
  constructor(
    private readonly teamProfileService: TeamProfileService,
    private readonly delegationRecallService: DelegationRecallService,
    private readonly portableIdentityService: PortableIdentityService,
    private readonly taskCompletionService: TaskCompletionService,
    private readonly delegationTemplateService: DelegationTemplateService,
    private readonly trustProfileService: TrustProfileService,
  ) {}

  // === HEY-188: Team Profiles ===

  @Post('teams')
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a team profile' })
  async createTeam(@Body() dto: CreateTeamDto) {
    return this.teamProfileService.createTeam(dto);
  }

  @Get('teams/:id')
  @ApiOperation({ summary: 'Get a team profile' })
  @ApiParam({ name: 'id', description: 'Team ID' })
  async getTeam(@Param('id') id: string) {
    return this.teamProfileService.getTeam(id);
  }

  @Get('teams/:id/capabilities')
  @ApiOperation({ summary: 'Get aggregated team capabilities' })
  @ApiParam({ name: 'id', description: 'Team ID' })
  async getTeamCapabilities(@Param('id') id: string) {
    return this.teamProfileService.getTeamCapabilities(id);
  }

  // === HEY-189: Delegation-Aware Recall ===

  @Get('delegation-recall')
  @ApiOperation({ summary: 'Get delegation-aware recall for a task' })
  @ApiQuery({ name: 'task', description: 'Task description', required: true })
  @ApiQuery({ name: 'userId', required: false })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async delegationRecall(
    @Query('task') task: string,
    @Query('userId') userId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.delegationRecallService.recall(
      task,
      userId,
      limit ? parseInt(limit, 10) : 5,
    );
  }

  // === HEY-190: Portable Agent Identity ===

  @Get('agents/:id/export')
  @ApiOperation({ summary: 'Export agent identity' })
  @ApiParam({ name: 'id', description: 'Agent ID' })
  async exportIdentity(@Param('id') id: string) {
    return this.portableIdentityService.exportIdentity(id);
  }

  @Post('agents/import')
  @HttpCode(200)
  @ApiOperation({ summary: 'Import agent identity' })
  async importIdentity(@Body() dto: ImportIdentityDto) {
    return this.portableIdentityService.importIdentity(
      dto.identity,
      dto.targetAgentId,
    );
  }
}
