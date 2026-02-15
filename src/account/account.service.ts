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
import { Resend } from 'resend';
import { PLAN_LIMITS } from './plan-limits.js';

interface AccessCode {
  code: string;
  plan: string;
  maxUses: number;
  usedCount?: number; // Deprecated: usage now tracked via DB (account.accessCode field)
  expiresAt?: string | null;
}

@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  private getAccessCodes(): AccessCode[] {
    const raw = this.config.get<string>('ACCESS_CODES', '[]');
    try {
      return JSON.parse(raw);
    } catch {
      this.logger.warn('Failed to parse ACCESS_CODES env var');
      return [];
    }
  }

  private async validateAccessCode(code: string): Promise<AccessCode | null> {
    const codes = this.getAccessCodes();
    const found = codes.find((c) => c.code === code);
    if (!found) return null;
    if (found.expiresAt && new Date(found.expiresAt) < new Date()) return null;

    // Check persistent usage from DB (survives deploys)
    if (found.maxUses !== -1) {
      const usedCount = await this.prisma.account.count({
        where: { accessCode: code },
      });
      if (usedCount >= found.maxUses) return null;
    }

    return found;
  }

  async register(email: string, password: string, name?: string, plan?: string, accessCode?: string) {
    // Validate plan/accessCode requirements
    if (!accessCode && !plan) {
      throw new BadRequestException('Please select a plan or enter an access code');
    }

    if (plan && plan.toUpperCase() === 'FREE') {
      throw new BadRequestException('Free tier is available via self-hosting. Cloud plans start at $9/mo');
    }

    let resolvedPlan: string = 'STARTER';
    let activatedByCode = false;

    if (accessCode) {
      const validCode = await this.validateAccessCode(accessCode);
      if (!validCode) {
        throw new BadRequestException('Invalid or expired access code');
      }
      resolvedPlan = validCode.plan;
      activatedByCode = true;
    } else if (plan) {
      const upperPlan = plan.toUpperCase();
      if (!['STARTER', 'PRO', 'SCALE'].includes(upperPlan)) {
        throw new BadRequestException('Invalid plan. Choose STARTER, PRO, or SCALE');
      }
      resolvedPlan = upperPlan;
    }

    const existing = await this.prisma.account.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await bcrypt.hash(password, 12);

    // Create account + default agent in a transaction
    const { account, agent, apiKey } = await this.prisma.$transaction(
      async (tx) => {
        const account = await tx.account.create({
          data: {
            email,
            passwordHash,
            name,
            plan: activatedByCode ? (resolvedPlan as any) : 'FREE',
            ...(activatedByCode && accessCode ? { accessCode } : {}),
          },
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

    // Access code usage is now tracked persistently via the accessCode field on the account record.
    // No need to increment in-memory counters.

    const token = this.signToken(account);

    return {
      token,
      apiKey,
      account: this.sanitizeAccount(account),
      agent: { id: agent.id, name: agent.name, apiKeyHint: agent.apiKeyHint },
      needsPayment: !activatedByCode,
      selectedPlan: resolvedPlan,
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

  async deleteApiKey(accountId: string, agentId: string) {
    // Ensure the agent belongs to this account
    const agent = await this.prisma.agent.findFirst({
      where: { id: agentId, accountId, deletedAt: null },
    });
    if (!agent) {
      throw new BadRequestException('API key not found');
    }
    await this.prisma.agent.update({
      where: { id: agentId },
      data: { deletedAt: new Date() },
    });
  }

  async updateAccount(accountId: string, data: { name?: string }) {
    const updateData: any = {};
    if (data.name !== undefined) updateData.name = data.name;

    const account = await this.prisma.account.update({
      where: { id: accountId },
      data: updateData,
    });
    return this.sanitizeAccount(account);
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

    const dashboardUrl = this.config.get<string>('DASHBOARD_URL', 'https://app.openengram.ai');
    const resetUrl = `${dashboardUrl}/reset-password?token=${rawToken}`;

    // Send email via Resend
    const resendKey = this.config.get<string>('RESEND_API_KEY');
    if (resendKey) {
      try {
        const resend = new Resend(resendKey);
        await resend.emails.send({
          from: 'Engram <noreply@openengram.ai>',
          to: email,
          subject: 'Reset your Engram password',
          text: `Reset your password: ${resetUrl}\n\nThis link expires in 1 hour.`,
          html: `<p>Reset your password: <a href="${resetUrl}">${resetUrl}</a></p><p>This link expires in 1 hour.</p>`,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Failed to send reset email: ${msg}`);
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
