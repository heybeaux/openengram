import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { Account, Plan } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes, createHash } from 'crypto';
import { PLAN_LIMITS } from './plan-limits.js';

@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
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
