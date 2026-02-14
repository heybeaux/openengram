import {
  Injectable,
  NestMiddleware,
  HttpException,
  Logger,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { PrismaService } from '../../prisma/prisma.service.js';
import { PLAN_LIMITS } from '../../account/plan-limits.js';

/**
 * Usage limit middleware for multi-tenant SaaS.
 *
 * Runs AFTER API key auth resolves the agent. If the agent has an accountId,
 * checks plan limits and increments daily API call counter.
 * Agents without accounts (self-hosted) pass through freely.
 */
@Injectable()
export class UsageLimitMiddleware implements NestMiddleware {
  private readonly logger = new Logger(UsageLimitMiddleware.name);

  constructor(private prisma: PrismaService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    // Agent is attached by ApiKeyGuard — grab accountId from it
    const agent = (req as any).agent;
    if (!agent?.accountId) {
      // Self-hosted agent without account — no limits
      return next();
    }

    const account = await this.prisma.account.findUnique({
      where: { id: agent.accountId },
    });
    if (!account) {
      return next();
    }

    const limits = PLAN_LIMITS[account.plan];

    // Reset daily counter if needed
    const now = new Date();
    const resetAt = account.apiCallsResetAt;
    let apiCallsToday = account.apiCallsToday;

    if (!resetAt || now.toDateString() !== resetAt.toDateString()) {
      // New day — reset counter
      await this.prisma.account.update({
        where: { id: account.id },
        data: { apiCallsToday: 0, apiCallsResetAt: now },
      });
      apiCallsToday = 0;
    }

    // Check API calls limit
    if (
      limits.apiCallsPerDay !== -1 &&
      apiCallsToday >= limits.apiCallsPerDay
    ) {
      throw new HttpException(
        {
          statusCode: 429,
          error: 'Too Many Requests',
          message: `Daily API call limit reached (${limits.apiCallsPerDay}/day on ${account.plan} plan). Upgrade for higher limits.`,
        },
        429,
      );
    }

    // Check memory limit on creation endpoints
    const isMemoryCreation =
      req.method === 'POST' && req.path.includes('/memories');
    if (
      isMemoryCreation &&
      limits.memories !== -1 &&
      account.memoriesUsed >= limits.memories
    ) {
      throw new HttpException(
        {
          statusCode: 429,
          error: 'Too Many Requests',
          message: `Memory limit reached (${limits.memories} on ${account.plan} plan). Upgrade for more storage.`,
        },
        429,
      );
    }

    // Increment API calls counter
    await this.prisma.account.update({
      where: { id: account.id },
      data: { apiCallsToday: { increment: 1 } },
    });

    // Attach account to request for downstream use
    (req as any).account = account;

    next();
  }
}
