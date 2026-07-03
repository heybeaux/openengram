import { Controller, Post, Body, Param, UseGuards } from '@nestjs/common';
import { CorrectionService } from './correction.service';
import { ApiKeyOrJwtGuard } from '../common/guards/api-key-or-jwt.guard';
import { UserId } from '../common/decorators/user-id.decorator';
import { IsString, IsOptional } from 'class-validator';

export class ManualCorrectDto {
  @IsString()
  correctedContent: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

@Controller('v1/memories')
@UseGuards(ApiKeyOrJwtGuard)
export class CorrectionController {
  constructor(private readonly correctionService: CorrectionService) {}

  /**
   * POST /v1/memories/:id/correct
   * Manually correct a memory — creates a new correction memory and supersedes the old one.
   */
  @Post(':id/correct')
  async correct(
    @UserId() userId: string,
    @Param('id') memoryId: string,
    @Body() dto: ManualCorrectDto,
  ): Promise<{ correctionId: string; supersededId: string }> {
    return this.correctionService.manualCorrect(
      userId,
      memoryId,
      dto.correctedContent,
      dto.reason,
    );
  }
}
