import { Controller, Post, Get, Query, Body, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { EvalService } from './eval.service';
import { ApiKeyGuard } from '../common/guards/api-key.guard';

@ApiTags('Eval')
@Controller('v1/eval')
@UseGuards(ApiKeyGuard)
export class EvalController {
  constructor(private readonly evalService: EvalService) {}

  /**
   * POST /v1/eval/run
   * Trigger an eval run and return results.
   */
  @Post('run')
  async runEval(@Body() body?: { triggeredBy?: string }) {
    return this.evalService.runEval(body?.triggeredBy ?? 'api');
  }

  /**
   * GET /v1/eval/history
   * Get eval run history.
   */
  @Get('history')
  async getHistory(@Query('limit') limit?: string) {
    return this.evalService.getHistory(limit ? parseInt(limit, 10) : 20);
  }

  /**
   * GET /v1/eval/regression
   * Check for regressions against recent baseline.
   */
  @Get('regression')
  async detectRegression() {
    return this.evalService.detectRegression();
  }
}
