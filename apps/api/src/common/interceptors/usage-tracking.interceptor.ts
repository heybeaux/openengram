import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  HttpException,
  Logger,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { tap } from 'rxjs/operators';
import { PrismaService } from '../../prisma/prisma.service.js';
import { PLAN_LIMITS } from '../../account/plan-limits.js';

/**
 * Usage tracking interceptor for multi-tenant SaaS.
 *
 * Runs AFTER guards (ApiKeyGuard sets req.agent), so req.agent.accountId
 * is available. Checks plan limits and increments daily API call counter.
 *
 * NOTE: This replaces UsageLimitMiddleware which could never work because
 * middleware runs before guards — req.agent was always undefined (HEY-197).
 */
@Injectable()
export class UsageTrackingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(UsageTrackingInterceptor.name);

  constructor(private prisma: PrismaService) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest();
    const agent = request.agent;

    if (!agent?.accountId) {
      // Self-hosted agent without account — no limits
      return next.handle();
    }

    const account = await this.prisma.account.findUnique({
      where: { id: agent.accountId },
    });
    if (!account) {
      return next.handle();
    }

    const limits = PLAN_LIMITS[account.plan];

    // Atomic: reset-if-new-day + increment in one query
    const result = await this.prisma.$queryRaw<
      Array<{ api_calls_today: number; memories_used: number }>
    >`
      UPDATE accounts SET
        api_calls_today = CASE
          WHEN api_calls_reset_at IS NULL OR api_calls_reset_at::date < CURRENT_DATE
          THEN 1
          ELSE api_calls_today + 1
        END,
        api_calls_reset_at = NOW()
      WHERE id = ${account.id}
      RETURNING api_calls_today, memories_used
    `;

    const apiCallsToday = result[0]?.api_calls_today ?? 0;
    const memoriesUsed = result[0]?.memories_used ?? account.memoriesUsed;

    // Check API calls limit
    if (limits.apiCallsPerDay !== -1 && apiCallsToday > limits.apiCallsPerDay) {
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
      request.method === 'POST' && request.path.includes('/memories');
    if (
      isMemoryCreation &&
      limits.memories !== -1 &&
      memoriesUsed >= limits.memories
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

    // Attach account to request for downstream use
    request.account = account;

    return next.handle();
  }
}
