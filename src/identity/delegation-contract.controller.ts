import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam } from '@nestjs/swagger';
import { ApiKeyOrJwtGuard } from '../common/guards/api-key-or-jwt.guard';
import { DelegationContractService } from './delegation-contract.service';
import { CreateDelegationContractDto, CompleteContractRequestDto } from './dto/delegation-contract.dto';

@ApiTags('delegation-contracts')
@UseGuards(ApiKeyOrJwtGuard)
@Controller('v1/delegation-contracts')
export class DelegationContractController {
  constructor(private readonly contractService: DelegationContractService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a delegation contract' })
  async create(@Body() dto: CreateDelegationContractDto) {
    return this.contractService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all delegation contracts' })
  async list() {
    return this.contractService.listAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a delegation contract by ID' })
  @ApiParam({ name: 'id', description: 'Contract ID' })
  async getById(@Param('id') id: string) {
    return this.contractService.getById(id);
  }

  @Patch(':id/status')
  @HttpCode(200)
  @ApiOperation({ summary: 'Update contract status (complete/fail)' })
  @ApiParam({ name: 'id', description: 'Contract ID' })
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: CompleteContractRequestDto,
  ) {
    return this.contractService.complete(id, dto);
  }
}
