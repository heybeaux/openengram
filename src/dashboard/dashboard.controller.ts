import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { DashboardService, StatsResponse, MemoriesListResponse, UsersListResponse, UserDetailResponse } from './dashboard.service';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { Agent } from '../common/decorators/user-id.decorator';
import { ListMemoriesDto } from './dto/list-memories.dto';

@Controller('v1')
@UseGuards(ApiKeyGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  /**
   * GET /v1/stats
   * Dashboard overview statistics
   */
  @Get('stats')
  async getStats(@Agent() agent: any): Promise<StatsResponse> {
    return this.dashboardService.getStats(agent.id);
  }

  /**
   * GET /v1/memories
   * List memories with pagination and filters
   */
  @Get('memories')
  async listMemories(
    @Agent() agent: any,
    @Query() dto: ListMemoriesDto,
  ): Promise<MemoriesListResponse> {
    return this.dashboardService.listMemories(agent.id, dto);
  }

  /**
   * GET /v1/users
   * List all users with memory stats
   */
  @Get('users')
  async listUsers(@Agent() agent: any): Promise<UsersListResponse> {
    return this.dashboardService.listUsers(agent.id);
  }

  /**
   * GET /v1/users/:id
   * User detail with stats
   */
  @Get('users/:id')
  async getUserDetail(@Param('id') id: string): Promise<UserDetailResponse> {
    const user = await this.dashboardService.getUserDetail(id);
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }
    return user;
  }
}
