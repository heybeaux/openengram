import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { Account, Plan } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes, createHash } from 'crypto';
import * as nodemailer from 'nodemailer';
import { PLAN_LIMITS } from './plan-limits.js';

@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  async register(email: string, password: string, name?: string) {
    const existing = await this.prisma.account.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await bcrypt.hash(password, 12);

    // Create account + default agent in a transaction
    const { account, agent, apiKey } = await this.prisma.$transaction(
      async (tx) => {
        const account = await tx.account.create({
          data: { email, passwordHash, name },
        });

        // Generate API key
        const rawKey = `eng_${randomBytes(24).toString('hex')}`;
        const apiKeyHash = createHash('sha256').update(rawKey).digest('hex');
        const apiKeyHint = rawKey.slice(0, 8) + '...' + rawKey.slice(-4);

        const agent = await tx.agent.create({
          data: {
            name: name ? `${name}'s Agent` : 'Default Agent',
            apiKeyHash,
            apiKeyHint,
            accountId: account.id,
          },
        });

        return { account, agent, apiKey: rawKey };
      },
    );

    const token = this.signToken(account);

    return {
      token,
      apiKey,
      account: this.sanitizeAccount(account),
      agent: { id: agent.id, name: agent.name, apiKeyHint: agent.apiKeyHint },
    };
  }

  async login(email: string, password: string) {
    const account = await this.prisma.account.findUnique({
      where: { email },
      include: { agents: { where: { deletedAt: null }, take: 1 } },
    });
    if (!account) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await bcrypt.compare(password, account.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const token = this.signToken(account);
    const primaryAgent = account.agents[0];

    return {
      token,
      apiKey: primaryAgent?.apiKeyHint ?? null,
      account: this.sanitizeAccount(account),
    };
  }

  async getAccount(accountId: string) {
    const account = await this.prisma.account.findUniqueOrThrow({
      where: { id: accountId },
    });

    const limits = PLAN_LIMITS[account.plan];

    return {
      ...this.sanitizeAccount(account),
      usage: {
        memoriesUsed: account.memoriesUsed,
        memoriesLimit: limits.memories,
        apiCallsToday: account.apiCallsToday,
        apiCallsPerDayLimit: limits.apiCallsPerDay,
      },
      limits,
    };
  }

  async listApiKeys(accountId: string) {
    const agents = await this.prisma.agent.findMany({
      where: { accountId, deletedAt: null },
      select: { id: true, name: true, apiKeyHint: true, createdAt: true },
    });
    return agents;
  }

  async createApiKey(accountId: string, agentName?: string) {
    const account = await this.prisma.account.findUniqueOrThrow({
      where: { id: accountId },
    });

    const limits = PLAN_LIMITS[account.plan];
    if (limits.agents !== -1) {
      const count = await this.prisma.agent.count({
        where: { accountId, deletedAt: null },
      });
      if (count >= limits.agents) {
        throw new ForbiddenException(
          `Plan ${account.plan} allows max ${limits.agents} agent(s). Upgrade to create more.`,
        );
      }
    }

    const rawKey = `eng_${randomBytes(24).toString('hex')}`;
    const apiKeyHash = createHash('sha256').update(rawKey).digest('hex');
    const apiKeyHint = rawKey.slice(0, 8) + '...' + rawKey.slice(-4);

    const agent = await this.prisma.agent.create({
      data: {
        name: agentName || 'New Agent',
        apiKeyHash,
        apiKeyHint,
        accountId,
      },
    });

    return {
      apiKey: rawKey,
      agent: { id: agent.id, name: agent.name, apiKeyHint: agent.apiKeyHint },
    };
  }

  async forgotPassword(email: string) {
    const account = await this.prisma.account.findUnique({ where: { email } });
    // Always return success to prevent email enumeration
    if (!account) {
      return { message: 'If that email is registered, a reset link has been sent.' };
    }

    // Generate token and store hash
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await this.prisma.account.update({
      where: { id: account.id },
      data: { resetToken: tokenHash, resetTokenExpiresAt: expiresAt },
    });

    const resetUrl = `https://openengram.ai/reset-password?token=${rawToken}`;

    // Try to send email
    const smtpHost = this.config.get<string>('SMTP_HOST');
    if (smtpHost) {
      try {
        const transporter = nodemailer.createTransport({
          host: smtpHost,
          port: parseInt(this.config.get<string>('SMTP_PORT', '587'), 10),
          auth: {
            user: this.config.get<string>('SMTP_USER'),
            pass: this.config.get<string>('SMTP_PASS'),
          },
        });

        await transporter.sendMail({
          from: this.config.get<string>('SMTP_FROM', 'noreply@openengram.ai'),
          to: email,
          subject: 'Reset your Engram password',
          text: `Reset your password: ${resetUrl}\n\nThis link expires in 1 hour.`,
          html: `<p>Reset your password: <a href="${resetUrl}">${resetUrl}</a></p><p>This link expires in 1 hour.</p>`,
        });
      } catch (err) {
        this.logger.error(`Failed to send reset email: ${err.message}`);
      }
    } else {
      this.logger.log(`[DEV] Password reset link for ${email}: ${resetUrl}`);
    }

    return { message: 'If that email is registered, a reset link has been sent.' };
  }

  async resetPassword(token: string, newPassword: string) {
    const tokenHash = createHash('sha256').update(token).digest('hex');

    const account = await this.prisma.account.findFirst({
      where: { resetToken: tokenHash },
    });

    if (!account || !account.resetTokenExpiresAt || account.resetTokenExpiresAt < new Date()) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);

    await this.prisma.account.update({
      where: { id: account.id },
      data: { passwordHash, resetToken: null, resetTokenExpiresAt: null },
    });

    return { message: 'Password has been reset successfully.' };
  }

  async changePassword(accountId: string, currentPassword: string, newPassword: string) {
    const account = await this.prisma.account.findUniqueOrThrow({
      where: { id: accountId },
    });

    const valid = await bcrypt.compare(currentPassword, account.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.prisma.account.update({
      where: { id: accountId },
      data: { passwordHash },
    });

    return { message: 'Password changed successfully.' };
  }

  async deleteAccount(accountId: string) {
    await this.prisma.$transaction(async (tx) => {
      // Get all agents for this account
      const agents = await tx.agent.findMany({
        where: { accountId },
        select: { id: true },
      });
      const agentIds = agents.map((a) => a.id);

      if (agentIds.length > 0) {
        // Get all users for these agents
        const users = await tx.user.findMany({
          where: { agentId: { in: agentIds } },
          select: { id: true },
        });
        const userIds = users.map((u) => u.id);

        if (userIds.length > 0) {
          // Delete memories and related data (cascade handles most)
          await tx.memory.deleteMany({ where: { userId: { in: userIds } } });
          await tx.session.deleteMany({ where: { userId: { in: userIds } } });
          await tx.project.deleteMany({ where: { userId: { in: userIds } } });
          await tx.user.deleteMany({ where: { id: { in: userIds } } });
        }

        // Delete agents (cascades webhooks etc)
        await tx.agent.deleteMany({ where: { accountId } });
      }

      // Delete the account
      await tx.account.delete({ where: { id: accountId } });
    });
  }

  private signToken(account: Account): string {
    return this.jwt.sign({ sub: account.id, email: account.email });
  }

  private sanitizeAccount(account: Account) {
    return {
      id: account.id,
      email: account.email,
      name: account.name,
      plan: account.plan,
      createdAt: account.createdAt,
    };
  }
}
