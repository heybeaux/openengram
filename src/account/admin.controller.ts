import {
  Controller,
  Get,
  UseGuards,
  Req,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AccountJwtGuard } from './account.guard.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ConfigService } from '@nestjs/config';

@ApiTags('admin')
@Controller('v1/admin')
export class AdminController {
  private readonly adminEmails: string[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.adminEmails = config
      .get<string>('ADMIN_EMAILS', 'hello@heybeaux.dev')
      .split(',')
      .map((e) => e.trim().toLowerCase());
  }

  @Get('accounts')
  @UseGuards(AccountJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all accounts (admin only)' })
  async listAccounts(@Req() req: any) {
    // Look up requesting account's email
    const account = await this.prisma.account.findUnique({
      where: { id: req.accountId },
      select: { email: true },
    });

    if (!account || !this.adminEmails.includes(account.email.toLowerCase())) {
      throw new ForbiddenException('Admin access required');
    }

    // Use raw query to bypass RLS proxy
    const accounts = await this.prisma.$queryRawUnsafe(
      'SELECT id, email, plan, memories_used, api_calls_today, created_at FROM accounts ORDER BY created_at DESC',
    );

    return { accounts };
  }
}
