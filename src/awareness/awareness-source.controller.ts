import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam } from '@nestjs/swagger';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { AwarenessSourceService, SignalSourceConfig } from './awareness-source.service';

class CreateSourceDto {
  name: string;
  type: 'linear' | 'github' | 'memory' | 'custom';
  enabled?: boolean;
  config?: Record<string, any>;
}

class UpdateSourceDto {
  name?: string;
  enabled?: boolean;
  config?: Record<string, any>;
}

@ApiTags('awareness')
@UseGuards(ApiKeyGuard)
@Controller('v1/awareness/sources')
export class AwarenessSourceController {
  constructor(private readonly sourceService: AwarenessSourceService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Create an awareness signal source' })
  async create(@Body() dto: CreateSourceDto) {
    return this.sourceService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all awareness signal sources' })
  async list() {
    return this.sourceService.listAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a signal source by ID' })
  @ApiParam({ name: 'id', description: 'Source ID' })
  async getById(@Param('id') id: string) {
    return this.sourceService.getById(id);
  }

  @Patch(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Update a signal source' })
  @ApiParam({ name: 'id', description: 'Source ID' })
  async update(@Param('id') id: string, @Body() dto: UpdateSourceDto) {
    return this.sourceService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Delete a signal source' })
  @ApiParam({ name: 'id', description: 'Source ID' })
  async delete(@Param('id') id: string) {
    return this.sourceService.delete(id);
  }
}
