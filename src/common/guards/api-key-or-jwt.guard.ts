import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiKeyGuard } from './api-key.guard';
import { ConfigService } from '@nestjs/config';

/**
 * Combined guard: accepts EITHER a valid API key (X-AM-API-Key)
 * OR a valid JWT Bearer token. Tries API key first, falls back to JWT.
 *
 * When JWT is used, resolves the account's first agent and sets
 * request.agent so the @Agent() decorator works.
 */
@Injectable()
export class ApiKeyOrJwtGuard implements CanActivate {
  private readonly apiKeyGuard: ApiKeyGuard;

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.apiKeyGuard = new ApiKeyGuard(prisma, config);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    // If API key header is present, use ApiKeyGuard
    if (request.headers['x-am-api-key']) {
      return this.apiKeyGuard.canActivate(context);
    }

    // Try JWT Bearer token
    const authHeader = request.headers['authorization'];
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      let payload: any;
      try {
        payload = this.jwt.verify(token);
      } catch {
        throw new UnauthorizedException('Invalid or expired token');
      }

      const accountId = payload.sub;
      if (!accountId) {
        throw new UnauthorizedException('Invalid token payload');
      }

      request.accountId = accountId;

      // Resolve the account's first active agent for @Agent() decorator
      const agent = await this.prisma.agent.findFirst({
        where: { accountId, deletedAt: null },
        orderBy: { createdAt: 'asc' },
      });

      if (!agent) {
        throw new UnauthorizedException('No agent found for this account');
      }

      request.agent = agent;
      return true;
    }

    throw new UnauthorizedException(
      'Missing authentication: provide X-AM-API-Key or Authorization Bearer token',
    );
  }
}
