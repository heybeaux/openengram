import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PLAN_LIMITS } from '../../account/plan-limits';

/**
 * Guard for account-JWT authenticated routes.
 * Checks plan limits and increments API call counter.
 * Apply AFTER AccountJwtGuard so req.accountId is set.
 */
@Injectable()
export class UsageLimitGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const accountId = request.accountId;
    if (!accountId) return true; // No account context — skip

    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
    });
    if (!account) return true;

    const limits = PLAN_LIMITS[account.plan];
    const now = new Date();
    let apiCallsToday = account.apiCallsToday;

    // Reset daily counter if needed
    const resetAt = account.apiCallsResetAt;
    if (!resetAt || now.toDateString() !== resetAt.toDateString()) {
      await this.prisma.account.update({
        where: { id: account.id },
        data: { apiCallsToday: 0, apiCallsResetAt: now },
      });
      apiCallsToday = 0;
    }

    // Check API calls limit
    if (limits.apiCallsPerDay !== -1 && apiCallsToday >= limits.apiCallsPerDay) {
      throw new HttpException(
        {
          statusCode: 429,
          message:
            'Plan limit reached. Upgrade at https://openengram.ai/billing',
        },
        429,
      );
    }

    // Check memory limit on creation endpoints
    const req = context.switchToHttp().getRequest();
    const isMemoryCreation =
      req.method === 'POST' && req.path?.includes('/memories');
    if (
      isMemoryCreation &&
      limits.memories !== -1 &&
      account.memoriesUsed >= limits.memories
    ) {
      throw new HttpException(
        {
          statusCode: 429,
          message:
            'Plan limit reached. Upgrade at https://openengram.ai/billing',
        },
        429,
      );
    }

    // Increment API calls counter
    await this.prisma.account.update({
      where: { id: account.id },
      data: { apiCallsToday: { increment: 1 } },
    });

    return true;
  }
}
