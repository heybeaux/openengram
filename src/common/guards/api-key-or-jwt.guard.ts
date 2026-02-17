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
import { createHash } from 'crypto';

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

    // If API key header is present, check for instance key first
    if (request.headers['x-am-api-key']) {
      const apiKey = request.headers['x-am-api-key'];

      // Instance API keys: eng_inst_ prefix → validate as account-level key
      if (typeof apiKey === 'string' && apiKey.startsWith('eng_inst_')) {
        const keyHash = createHash('sha256').update(apiKey).digest('hex');
        const instanceKey = await this.prisma.instanceApiKey.findUnique({
          where: { keyHash },
          include: { account: true },
        });
        if (!instanceKey || instanceKey.deletedAt) {
          throw new UnauthorizedException('Invalid instance API key');
        }
        if (instanceKey.expiresAt && instanceKey.expiresAt < new Date()) {
          throw new UnauthorizedException('Instance API key has expired');
        }
        // Update lastUsedAt (best-effort)
        this.prisma.instanceApiKey.update({
          where: { id: instanceKey.id },
          data: { lastUsedAt: new Date() },
        }).catch(() => {});

        request.accountId = instanceKey.accountId;
        request.isInstanceKey = true;
        request.instanceKeyScopes = instanceKey.scopes;
        // Resolve default agent for controllers that need @Agent()
        const defaultAgent = await this.prisma.agent.findFirst({
          where: { accountId: instanceKey.accountId, deletedAt: null },
          orderBy: { createdAt: 'asc' },
        });
        request.agent = defaultAgent;

        // Resolve user for @UserId() — needed for recall/query endpoints
        if (defaultAgent) {
          const externalUserId = request.headers['x-am-user-id'];
          let user: any = null;
          if (externalUserId) {
            user = await this.prisma.user.findUnique({
              where: {
                agentId_externalId: {
                  agentId: defaultAgent.id,
                  externalId: externalUserId,
                },
              },
            });
            if (!user) {
              user = await this.prisma.user.create({
                data: { agentId: defaultAgent.id, externalId: externalUserId },
              });
            }
          }
          if (!user) {
            // Fall back to first user for this agent
            user = await this.prisma.user.findFirst({
              where: { agentId: defaultAgent.id },
              orderBy: { createdAt: 'asc' },
            });
          }
          request.user = user;
        }
        return true;
      }

      // Regular agent API key
      return this.apiKeyGuard.canActivate(context);
    }

    // LAN bypass: allow local requests without credentials when TRUST_LOCAL_NETWORK=true
    // Only enabled for local edition (not cloud/prod deployments)
    const edition = this.config.get<string>('EDITION', 'local');
    const lanBypassEnv = this.config.get<string>('LAN_BYPASS', '');
    const isLocalEdition = edition === 'local' || lanBypassEnv === 'true';
    const trustLocal =
      this.config.get<string>('TRUST_LOCAL_NETWORK', 'false') === 'true';
    if (isLocalEdition && trustLocal && this.isLocalIp(request)) {
      // LAN bypass: use header if provided, otherwise default to first user
      const externalUserId = request.headers['x-am-user-id'];
      const internalUserId = request.headers['x-user-id'];

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

        // No user ID headers at all — default to first user for this agent
        if (!user && !externalUserId && !internalUserId) {
          user = await this.prisma.user.findFirst({
            where: { agentId: agent.id },
            orderBy: { createdAt: 'asc' },
          });
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

      // Resolve or create a default user for this agent (needed by @UserId())
      const externalUserId =
        request.headers['x-am-user-id'] || payload.email || accountId;
      let user = await this.prisma.user.findUnique({
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
      request.user = user;

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
