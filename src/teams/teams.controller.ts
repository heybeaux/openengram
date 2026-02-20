import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { TeamsService } from './teams.service';
import {
  CreateTeamDto,
  UpdateTeamDto,
  AddTeamMemberDto,
  RecordCollaborationDto,
} from './dto/team.dto';
import { ApiKeyOrJwtGuard } from '../common/guards/api-key-or-jwt.guard';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard';
import { SanitizeInterceptor } from '../common/interceptors/sanitize.interceptor';
import { UserId } from '../common/decorators/user-id.decorator';

@ApiTags('teams')
@Controller('v1/teams')
@UseGuards(ApiKeyOrJwtGuard, RateLimitGuard)
@UseInterceptors(SanitizeInterceptor)
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a team' })
  async create(@UserId() userId: string, @Body() dto: CreateTeamDto) {
    return this.teamsService.create(userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all teams' })
  async findAll(@UserId() userId: string) {
    return this.teamsService.findAll(userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a team by ID' })
  async findOne(@UserId() userId: string, @Param('id') id: string) {
    return this.teamsService.findOne(userId, id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a team' })
  async update(
    @UserId() userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateTeamDto,
  ) {
    return this.teamsService.update(userId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a team (soft)' })
  async remove(@UserId() userId: string, @Param('id') id: string) {
    return this.teamsService.remove(userId, id);
  }

  // ── Members ──────────────────────────────────────────────────────────

  @Post(':id/members')
  @ApiOperation({ summary: 'Add a member to a team' })
  async addMember(
    @UserId() userId: string,
    @Param('id') teamId: string,
    @Body() dto: AddTeamMemberDto,
  ) {
    return this.teamsService.addMember(userId, teamId, dto);
  }

  @Delete(':id/members/:memberId')
  @ApiOperation({ summary: 'Remove a member from a team' })
  async removeMember(
    @UserId() userId: string,
    @Param('id') teamId: string,
    @Param('memberId') memberId: string,
  ) {
    return this.teamsService.removeMember(userId, teamId, memberId);
  }

  // ── Collaboration History ────────────────────────────────────────────

  @Post(':id/collaborations')
  @ApiOperation({ summary: 'Record a collaboration event' })
  async recordCollaboration(
    @UserId() userId: string,
    @Param('id') teamId: string,
    @Body() dto: RecordCollaborationDto,
  ) {
    return this.teamsService.recordCollaboration(userId, teamId, dto);
  }

  @Get(':id/collaborations')
  @ApiOperation({ summary: 'List collaboration history' })
  async getCollaborations(
    @UserId() userId: string,
    @Param('id') teamId: string,
    @Query('limit') limit?: string,
  ) {
    return this.teamsService.getCollaborations(
      userId,
      teamId,
      limit ? parseInt(limit, 10) : 50,
    );
  }
}
