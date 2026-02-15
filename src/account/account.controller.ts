import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AccountService } from './account.service.js';
import { AccountJwtGuard } from './account.guard.js';
import {
  RegisterDto,
  LoginDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  ChangePasswordDto,
  UpdateAccountDto,
} from './account.dto.js';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard';
import { RateLimit } from '../rate-limit/rate-limit.decorator';

@ApiTags('auth')
@Controller('v1')
export class AccountController {
  constructor(private readonly accountService: AccountService) {}

  @Get('auth/setup-status')
  @HttpCode(200)
  @ApiOperation({ summary: 'Check if initial setup is needed (no auth required)' })
  async getSetupStatus() {
    return this.accountService.getSetupStatus();
  }

  @Post('auth/register')
  @HttpCode(201)
  @UseGuards(RateLimitGuard)
  @RateLimit(5) // 5 per minute per IP
  @ApiOperation({ summary: 'Register a new account' })
  async register(@Body() body: RegisterDto) {
    return this.accountService.register(body.email, body.password, body.name, body.plan, body.accessCode);
  }

  @Post('auth/login')
  @HttpCode(200)
  @UseGuards(RateLimitGuard)
  @RateLimit(10) // 10 per minute per IP
  @ApiOperation({ summary: 'Login and get JWT' })
  async login(@Body() body: LoginDto) {
    return this.accountService.login(body.email, body.password);
  }

  @Post('auth/forgot-password')
  @HttpCode(200)
  @UseGuards(RateLimitGuard)
  @RateLimit(3)
  @ApiOperation({ summary: 'Request password reset email' })
  async forgotPassword(@Body() body: ForgotPasswordDto) {
    return this.accountService.forgotPassword(body.email);
  }

  @Post('auth/reset-password')
  @HttpCode(200)
  @UseGuards(RateLimitGuard)
  @RateLimit(3)
  @ApiOperation({ summary: 'Reset password with token' })
  async resetPassword(@Body() body: ResetPasswordDto) {
    return this.accountService.resetPassword(body.token, body.newPassword);
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

  @Post('account/change-password')
  @UseGuards(AccountJwtGuard)
  @ApiBearerAuth()
  @HttpCode(200)
  @ApiOperation({ summary: 'Change password (authenticated)' })
  async changePassword(@Req() req: any, @Body() body: ChangePasswordDto) {
    return this.accountService.changePassword(
      req.accountId,
      body.currentPassword,
      body.newPassword,
    );
  }

  @Delete('account')
  @UseGuards(AccountJwtGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete account and all data' })
  async deleteAccount(@Req() req: any) {
    await this.accountService.deleteAccount(req.accountId);
  }

  @Post('account/api-keys')
  @UseGuards(AccountJwtGuard)
  @ApiBearerAuth()
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a new API key (agent)' })
  async createApiKey(@Req() req: any, @Body() body: { name?: string }) {
    return this.accountService.createApiKey(req.accountId, body.name);
  }

  @Delete('account/api-keys/:id')
  @UseGuards(AccountJwtGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an API key (agent)' })
  async deleteApiKey(@Req() req: any, @Param('id') id: string) {
    await this.accountService.deleteApiKey(req.accountId, id);
  }

  @Patch('account')
  @UseGuards(AccountJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update account profile' })
  async updateAccount(@Req() req: any, @Body() body: UpdateAccountDto) {
    return this.accountService.updateAccount(req.accountId, body);
  }
}
