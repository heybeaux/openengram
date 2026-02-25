import { Controller, Get, Post, Body, Query, HttpCode, UseGuards } from '@nestjs/common';
import { ApiKeyOrJwtGuard } from '../common/guards/api-key-or-jwt.guard';
import { DelegationTaskService } from './delegation-task.service';
import type { LogTaskDto } from './delegation-task.service';

@Controller('v1/identity/delegation')
@UseGuards(ApiKeyOrJwtGuard)
export class DelegationController {
  constructor(private readonly taskService: DelegationTaskService) {}

  @Post('tasks')
  @HttpCode(201)
  logTask(@Body() dto: LogTaskDto) {
    const task = this.taskService.logTask(dto);
    return { id: task.id, createdAt: task.createdAt };
  }

  @Get('tasks')
  getTasks(
    @Query('agentId') agentId?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('since') since?: string,
  ) {
    return this.taskService.getTasks({
      agentId,
      status,
      limit: limit ? parseInt(limit, 10) : undefined,
      since,
    });
  }

  @Get('recall')
  getRecall(
    @Query('agentId') agentId?: string,
    @Query('task') task?: string,
    @Query('limit') limit?: string,
  ) {
    return this.taskService.getRecall({
      agentId,
      task,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }
}
