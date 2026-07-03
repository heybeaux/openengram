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
import { ChallengeService } from './challenge.service';
import {
  CreateChallengeRequestDto,
  ResolveChallengeRequestDto,
} from './dto/challenge.dto';

@ApiTags('challenges')
@UseGuards(ApiKeyOrJwtGuard)
@Controller('v1/challenges')
export class ChallengeController {
  constructor(private readonly challengeService: ChallengeService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a challenge' })
  async create(@Body() dto: CreateChallengeRequestDto) {
    return this.challengeService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all challenges' })
  @ApiQuery({ name: 'contractId', required: false })
  async list(@Query('contractId') contractId?: string) {
    return this.challengeService.listAll({ contractId });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a challenge by ID' })
  @ApiParam({ name: 'id', description: 'Challenge ID' })
  async getById(@Param('id') id: string) {
    return this.challengeService.getById(id);
  }

  @Post(':id/resolve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Resolve a challenge' })
  @ApiParam({ name: 'id', description: 'Challenge ID' })
  async resolve(
    @Param('id') id: string,
    @Body() dto: ResolveChallengeRequestDto,
  ) {
    return this.challengeService.resolve(id, dto);
  }
}

/**
 * Memory-scoped challenge endpoint.
 */
@ApiTags('challenges')
@UseGuards(ApiKeyOrJwtGuard)
@Controller('v1/memories')
export class MemoryChallengeController {
  constructor(private readonly challengeService: ChallengeService) {}

  @Post(':id/challenge')
  @HttpCode(201)
  @ApiOperation({ summary: 'Raise a challenge against a memory' })
  @ApiParam({ name: 'id', description: 'Memory ID' })
  async challengeMemory(
    @Param('id') memoryId: string,
    @Body() dto: CreateChallengeRequestDto,
  ) {
    return this.challengeService.create({
      ...dto,
      contractId: memoryId,
    });
  }
}
