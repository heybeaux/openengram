import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ScopedContextService } from './scoped-context.service';
import {
  ScopedContextRequestDto,
  ScopedContextResponseDto,
} from './dto/scoped-context.dto';
import { ApiKeyOrJwtGuard } from '../common/guards/api-key-or-jwt.guard';

@Controller('v1/context')
@UseGuards(ApiKeyOrJwtGuard)
export class ScopedContextController {
  constructor(private readonly scopedContextService: ScopedContextService) {}

  /**
   * POST /v1/context/scoped
   * Generate task-scoped context for a sub-agent session.
   */
  @Post('scoped')
  async generateScopedContext(
    @Body() dto: ScopedContextRequestDto,
  ): Promise<ScopedContextResponseDto> {
    return this.scopedContextService.generateScopedContext(dto);
  }
}
