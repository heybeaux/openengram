import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AgentSessionService } from './agent-session.service';
import {
  CreateAgentSessionDto,
  UpdateAgentSessionDto,
} from './dto/agent-session.dto';
import { ApiKeyGuard } from '../common/guards/api-key.guard';

@ApiTags('agent-sessions')
@UseGuards(ApiKeyGuard)
@Controller('v1/agent-sessions')
export class AgentSessionController {
  constructor(private readonly service: AgentSessionService) {}

  @Post()
  @ApiOperation({ summary: 'Register or upsert an agent session' })
  async upsert(@Body() dto: CreateAgentSessionDto) {
    return this.service.upsert(dto);
  }

  @Get(':key')
  @ApiOperation({ summary: 'Get agent session by key' })
  async getByKey(@Param('key') key: string) {
    return this.service.getByKey(key);
  }

  @Patch(':key')
  @ApiOperation({ summary: 'Update agent session status' })
  async update(@Param('key') key: string, @Body() dto: UpdateAgentSessionDto) {
    return this.service.updateStatus(key, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List agent sessions' })
  async list(@Query('parentKey') parentKey?: string) {
    if (parentKey) return this.service.listByParent(parentKey);
    return this.service.list();
  }
}
