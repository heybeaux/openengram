import {
  Controller,
  Post,
  Get,
  Patch,
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
import { DelegationContractService } from './delegation-contract.service';
import { ChallengeService } from './challenge.service';
import { CreateTeamDto } from './dto/team.dto';
import { ImportIdentityDto } from './dto/portable-identity.dto';
import {
  CreateTaskCompletionDto,
  QueryTaskCompletionsDto,
} from './dto/task-completion.dto';
import {
  CreateDelegationContractDto,
  CompleteContractRequestDto,
} from './dto/delegation-contract.dto';
import {
  CreateChallengeRequestDto,
  ResolveChallengeRequestDto,
} from './dto/challenge.dto';

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
    private readonly delegationContractService: DelegationContractService,
    private readonly challengeService: ChallengeService,
  ) {}

  // === HEY-281: Delegation Contracts CRUD ===

  @Post('contracts')
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a delegation contract' })
  async createContract(@Body() dto: CreateDelegationContractDto) {
    return this.delegationContractService.create(dto);
  }

  @Get('contracts')
  @ApiOperation({ summary: 'List delegation contracts' })
  @ApiQuery({ name: 'status', required: false, description: 'Filter by status' })
  @ApiQuery({ name: 'agentId', required: false, description: 'Filter by delegated agent ID' })
  async listContracts(
    @Query('status') status?: string,
    @Query('agentId') agentId?: string,
  ) {
    let contracts = this.delegationContractService.listAll();
    if (status) {
      contracts = contracts.filter((c) => c.status === status);
    }
    if (agentId) {
      contracts = contracts.filter((c) => c.delegatedTo === agentId);
    }
    return contracts;
  }

  @Get('contracts/:id')
  @ApiOperation({ summary: 'Get a delegation contract by ID' })
  @ApiParam({ name: 'id', description: 'Contract ID' })
  async getContract(@Param('id') id: string) {
    return this.delegationContractService.getById(id);
  }

  @Patch('contracts/:id/complete')
  @ApiOperation({ summary: 'Complete or fail a delegation contract' })
  @ApiParam({ name: 'id', description: 'Contract ID' })
  async completeContract(
    @Param('id') id: string,
    @Body() dto: CompleteContractRequestDto,
  ) {
    return this.delegationContractService.complete(id, dto);
  }

  // === HEY-282: Challenges CRUD ===

  @Post('challenges')
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a challenge' })
  async createChallenge(@Body() dto: CreateChallengeRequestDto) {
    return this.challengeService.create(dto);
  }

  @Get('challenges')
  @ApiOperation({ summary: 'List challenges' })
  @ApiQuery({ name: 'contractId', required: false, description: 'Filter by contract ID' })
  @ApiQuery({ name: 'status', required: false, description: 'Filter by resolution status (resolved/unresolved)' })
  async listChallenges(
    @Query('contractId') contractId?: string,
    @Query('status') status?: string,
  ) {
    let challenges = this.challengeService.listAll({ contractId });
    if (status === 'resolved') {
      challenges = challenges.filter((c) => c.resolution != null);
    } else if (status === 'unresolved') {
      challenges = challenges.filter((c) => c.resolution == null);
    }
    return challenges;
  }

  @Patch('challenges/:id/resolve')
  @ApiOperation({ summary: 'Resolve a challenge' })
  @ApiParam({ name: 'id', description: 'Challenge ID' })
  async resolveChallenge(
    @Param('id') id: string,
    @Body() dto: ResolveChallengeRequestDto,
  ) {
    return this.challengeService.resolve(id, dto);
  }

  // === HEY-283: Team Endpoints ===

  @Get('teams')
  @ApiOperation({ summary: 'List all teams' })
  async listTeams() {
    return this.teamProfileService.listTeams();
  }

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

  @Get('teams/:id/collaboration')
  @ApiOperation({ summary: 'Get collaboration pair scores for a team' })
  @ApiParam({ name: 'id', description: 'Team ID' })
  async getTeamCollaboration(@Param('id') id: string) {
    const team = await this.teamProfileService.getTeam(id);
    return this.teamProfileService.getCollaborationPairs(team.agentIds);
  }

  // === HEY-182: Task Completion Tracking ===

  @Post('task-completions')
  @HttpCode(201)
  @ApiOperation({ summary: 'Record a task completion' })
  async createTaskCompletion(@Body() dto: CreateTaskCompletionDto) {
    return this.taskCompletionService.create(dto);
  }

  @Get('task-completions')
  @ApiOperation({ summary: 'Query task completions' })
  @ApiQuery({ name: 'agentId', required: false })
  @ApiQuery({ name: 'taskId', required: false })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  async queryTaskCompletions(@Query() query: QueryTaskCompletionsDto) {
    return this.taskCompletionService.query(query);
  }

  // === HEY-183: Delegation Templates ===

  @Get('delegation-templates')
  @ApiOperation({ summary: 'Get delegation template suggestions for a task' })
  @ApiQuery({
    name: 'taskDescription',
    description: 'Task to get suggestions for',
    required: true,
  })
  async getDelegationTemplates(
    @Query('taskDescription') taskDescription: string,
  ) {
    if (!taskDescription) {
      return { error: 'taskDescription query parameter is required' };
    }
    return this.delegationTemplateService.suggest(taskDescription);
  }

  // === HEY-184: Trust Profiles ===

  @Get('agents/:id/trust-profile')
  @ApiOperation({ summary: 'Get domain-specific trust profile for an agent' })
  @ApiParam({ name: 'id', description: 'Agent ID' })
  async getTrustProfile(@Param('id') agentId: string) {
    return this.trustProfileService.getProfile(agentId);
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
