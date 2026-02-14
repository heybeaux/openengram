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

@ApiTags('auth')
@Controller('v1')
export class AccountController {
  constructor(private readonly accountService: AccountService) {}

  @Post('auth/register')
  @HttpCode(201)
  @ApiOperation({ summary: 'Register a new account' })
  async register(
    @Body() body: { email: string; password: string; name?: string },
  ) {
    return this.accountService.register(body.email, body.password, body.name);
  }

  @Post('auth/login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Login and get JWT' })
  async login(@Body() body: { email: string; password: string }) {
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
