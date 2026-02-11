import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Query,
  HttpCode,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import { MemoryLayer } from '@prisma/client';
import { AgentService } from './agent.service';
import { ReflectDto, ReflectionResultDto } from './dto/reflect.dto';

@ApiTags('agents')
@Controller('v1/agents')
export class AgentController {
  constructor(private readonly agentService: AgentService) {}

  /**
   * Trigger agent self-reflection
   *
   * Analyzes recent conversation turns to extract self-knowledge.
   * Creates memories about the agent itself (identity, lessons, preferences, working style).
   */
  @Post(':agentId/reflect')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Trigger agent self-reflection',
    description: `
Analyzes recent conversation turns to extract self-knowledge for the agent.
Creates memories with subjectType=AGENT that the agent can recall about itself.

**Categories of self-knowledge extracted:**
- **Identity**: Agent's name, role, capabilities, personality
- **Lessons Learned**: Mistakes made, corrections received, better approaches
- **User Preferences**: What the agent learned about the user's working style
- **Working Style**: Patterns in how the agent operates effectively

**Example use case (OpenClaw integration):**
Call this endpoint at the end of significant sessions to help the agent
build self-awareness and learn from interactions.
    `,
  })
  @ApiParam({
    name: 'agentId',
    description: 'Agent identifier (e.g., "rook", "openclaw-agent")',
  })
  @ApiResponse({
    status: 200,
    description: 'Reflection complete',
    type: ReflectionResultDto,
  })
  async reflect(
    @Param('agentId') agentId: string,
    @Body() dto: ReflectDto,
  ): Promise<ReflectionResultDto> {
    return this.agentService.reflect(agentId, dto);
  }

  /**
   * Get all self-memories for an agent
   */
  @Get(':agentId/memories')
  @ApiOperation({
    summary: 'Get agent self-memories',
    description: 'Retrieves all memories the agent has about itself.',
  })
  @ApiParam({
    name: 'agentId',
    description: 'Agent identifier',
  })
  @ApiQuery({
    name: 'layer',
    required: false,
    enum: MemoryLayer,
    description: 'Filter by memory layer',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Maximum number of memories to return',
  })
  async getMemories(
    @Param('agentId') agentId: string,
    @Query('layer') layer?: MemoryLayer,
    @Query('limit') limit?: number,
  ) {
    return this.agentService.getAgentMemories(agentId, {
      layer,
      limit: limit ? parseInt(String(limit), 10) : undefined,
    });
  }

  /**
   * Get formatted context for system prompt injection
   */
  @Get(':agentId/context')
  @ApiOperation({
    summary: 'Get agent context for prompt injection',
    description: `
Returns agent self-knowledge formatted for system prompt injection.
Use this when starting a session to include the agent's self-awareness.
    `,
  })
  @ApiParam({
    name: 'agentId',
    description: 'Agent identifier',
  })
  @ApiQuery({
    name: 'maxTokens',
    required: false,
    type: Number,
    description: 'Maximum tokens for context (default: 2000)',
  })
  async getContext(
    @Param('agentId') agentId: string,
    @Query('maxTokens') maxTokens?: number,
  ) {
    return this.agentService.getAgentContext(
      agentId,
      maxTokens ? parseInt(String(maxTokens), 10) : undefined,
    );
  }
}
