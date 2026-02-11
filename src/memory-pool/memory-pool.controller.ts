import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { MemoryPoolService } from './memory-pool.service';
import {
  CreateMemoryPoolDto,
  GrantPoolAccessDto,
  AddMemoryToPoolDto,
} from './dto/memory-pool.dto';

@ApiTags('memory-pools')
@Controller('v1/pools')
export class MemoryPoolController {
  constructor(private readonly service: MemoryPoolService) {}

  @Post()
  @ApiOperation({ summary: 'Create a memory pool' })
  async create(@Body() dto: CreateMemoryPoolDto) {
    return this.service.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List pools for a user' })
  async list(@Query('userId') userId: string) {
    return this.service.listByUser(userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get pool by ID' })
  async getById(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Post(':id/grant')
  @ApiOperation({ summary: 'Grant session access to pool' })
  async grant(@Param('id') id: string, @Body() dto: GrantPoolAccessDto) {
    return this.service.grantAccess(id, dto);
  }

  @Delete(':id/grant/:sessionId')
  @ApiOperation({ summary: 'Revoke session access to pool' })
  async revoke(@Param('id') id: string, @Param('sessionId') sessionId: string) {
    return this.service.revokeAccess(id, sessionId);
  }

  @Post(':id/memories')
  @ApiOperation({ summary: 'Add memory to pool' })
  async addMemory(@Param('id') id: string, @Body() dto: AddMemoryToPoolDto) {
    return this.service.addMemory(id, dto);
  }

  @Delete(':id/memories/:memoryId')
  @ApiOperation({ summary: 'Remove memory from pool' })
  async removeMemory(
    @Param('id') id: string,
    @Param('memoryId') memoryId: string,
  ) {
    return this.service.removeMemory(id, memoryId);
  }
}
