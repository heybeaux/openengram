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

    // If API key header is present, use ApiKeyGuard (which handles LAN bypass internally)
    if (request.headers['x-am-api-key']) {
      return this.apiKeyGuard.canActivate(context);
    }

    // LAN bypass: allow local requests without credentials when TRUST_LOCAL_NETWORK=true
    const trustLocal =
      this.config.get<string>('TRUST_LOCAL_NETWORK', 'false') === 'true';
    if (trustLocal && this.isLocalIp(request)) {
      // LAN bypass requires at least a user identification header
      const externalUserId = request.headers['x-am-user-id'];
      const internalUserId = request.headers['x-user-id'];

      if (!externalUserId && !internalUserId) {
        throw new UnauthorizedException(
          'LAN bypass requires X-AM-User-ID or X-User-ID header',
        );
      }

      const agent = await this.prisma.agent.findFirst({
        where: { deletedAt: null },
        orderBy: { createdAt: 'asc' },
      });

      if (agent) {
        let user: any = null;

        // If internal user ID provided, look up directly
        if (internalUserId) {
          user = await this.prisma.user.findUnique({
            where: { id: internalUserId },
          });
        }

        // Fall back to external ID lookup
        if (!user && externalUserId) {
          user = await this.prisma.user.findUnique({
            where: {
              agentId_externalId: {
                agentId: agent.id,
                externalId: externalUserId,
              },
            },
          });
          if (!user) {
            user = await this.prisma.user.create({
              data: { agentId: agent.id, externalId: externalUserId },
            });
          }
        }

        request.agent = agent;
        request.user = user;
        request.accountId = agent.accountId;
        request.isLanBypass = true;
      } else {
        request.agent = null;
        request.user = null;
        request.isLanBypass = true;
      }
      return true;
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

  private isLocalIp(request: any): boolean {
    const ip = request.ip || request.connection?.remoteAddress || '';
    return (
      ip === '127.0.0.1' ||
      ip === '::1' ||
      ip === '::ffff:127.0.0.1' ||
      ip.startsWith('10.') ||
      ip.startsWith('192.168.') ||
      ip.startsWith('::ffff:10.') ||
      ip.startsWith('::ffff:192.168.')
    );
  }
}
