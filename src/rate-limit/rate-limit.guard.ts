import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RateLimitService } from './rate-limit.service';
import { RATE_LIMIT_KEY, SKIP_RATE_LIMIT_KEY } from './rate-limit.decorator';

@Injectable()
export class RateLimitGuard implements CanActivate {
  // Default: 100 requests per minute
  private static readonly DEFAULT_LIMIT = 100;
  private static readonly WINDOW_MS = 60_000;

  constructor(
    private readonly rateLimitService: RateLimitService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    // Check for skip decorator
    const skip = this.reflector.getAllAndOverride<boolean>(
      SKIP_RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (skip) return true;

    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    // Get API key for per-key limiting, fall back to IP for unauthenticated endpoints
    const apiKey = request.headers['x-am-api-key'];
    const rateLimitIdentifier =
      apiKey || request.ip || request.connection?.remoteAddress || 'unknown';

    // Check for route-specific limit via decorator
    const routeLimit = this.reflector.getAllAndOverride<number | null>(
      RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );

    const limit = routeLimit ?? RateLimitGuard.DEFAULT_LIMIT;

    // Build key: identifier + route path
    const routePath = request.route?.path || request.url;
    const key = `${rateLimitIdentifier}:${routePath}`;

    const result = this.rateLimitService.consume(
      key,
      limit,
      RateLimitGuard.WINDOW_MS,
    );

    // Always set rate limit headers
    const resetTime = Math.ceil((Date.now() + RateLimitGuard.WINDOW_MS) / 1000);
    response.set('X-RateLimit-Limit', String(limit));
    response.set('X-RateLimit-Remaining', String(result.remaining));
    response.set('X-RateLimit-Reset', String(resetTime));

    if (!result.allowed) {
      const retryAfterSecs = Math.ceil(result.retryAfterMs / 1000);
      response.set('Retry-After', String(retryAfterSecs));
      response.set('X-RateLimit-Remaining', '0');
      response.set('X-RateLimit-Reset', String(Math.ceil((Date.now() + result.retryAfterMs) / 1000)));
      throw new HttpException(
        {
          statusCode: 429,
          message: `Rate limit exceeded. Try again in ${retryAfterSecs} second(s).`,
          retryAfter: retryAfterSecs,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
