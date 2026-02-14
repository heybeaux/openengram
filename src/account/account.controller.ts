import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  Req,
  HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AccountService } from './account.service.js';
import { AccountJwtGuard } from './account.guard.js';
import { RegisterDto, LoginDto } from './account.dto.js';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard';
import { RateLimit } from '../rate-limit/rate-limit.decorator';

@ApiTags('auth')
@Controller('v1')
export class AccountController {
  constructor(private readonly accountService: AccountService) {}

  @Post('auth/register')
  @HttpCode(201)
  @UseGuards(RateLimitGuard)
  @RateLimit(5) // 5 per minute per IP
  @ApiOperation({ summary: 'Register a new account' })
  async register(@Body() body: RegisterDto) {
    return this.accountService.register(body.email, body.password, body.name);
  }

  @Post('auth/login')
  @HttpCode(200)
  @UseGuards(RateLimitGuard)
  @RateLimit(10) // 10 per minute per IP
  @ApiOperation({ summary: 'Login and get JWT' })
  async login(@Body() body: LoginDto) {
    return this.accountService.login(body.email, body.password);
  }

  @Get('account')
  @UseGuards(AccountJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get account info and usage' })
  async getAccount(@Req() req: any) {
    return this.accountService.getAccount(req.accountId);
  }

  @Get('account/api-keys')
  @UseGuards(AccountJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List API keys (agents)' })
  async listApiKeys(@Req() req: any) {
    return this.accountService.listApiKeys(req.accountId);
  }

  @Post('account/api-keys')
  @UseGuards(AccountJwtGuard)
  @ApiBearerAuth()
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a new API key (agent)' })
  async createApiKey(@Req() req: any, @Body() body: { name?: string }) {
    return this.accountService.createApiKey(req.accountId, body.name);
  }
}
