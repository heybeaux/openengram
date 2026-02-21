import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam } from '@nestjs/swagger';
import { ApiKeyOrJwtGuard } from '../common/guards/api-key-or-jwt.guard';
import { IdentityController } from './identity.controller';

/**
 * Alias controller: exposes /v1/agents as a shortcut to /v1/identity/agents.
 * The dashboard calls /v1/agents and /v1/agents/:id directly.
 */
@ApiTags('agents')
@UseGuards(ApiKeyOrJwtGuard)
@Controller('v1/agents')
export class AgentsAliasController {
  constructor(private readonly identityController: IdentityController) {}

  @Get()
  @ApiOperation({ summary: 'List all agents (alias for /v1/identity/agents)' })
  async listAgents(@Req() req: any) {
    return this.identityController.listAgents(req);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single agent (alias for /v1/identity/agents/:id)' })
  @ApiParam({ name: 'id', description: 'Agent ID' })
  async getAgent(@Param('id') id: string, @Req() req: any) {
    return this.identityController.getAgent(id, req);
  }
}
