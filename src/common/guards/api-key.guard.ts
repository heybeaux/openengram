import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { createHash, createHmac } from 'crypto';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    // LAN bypass: IP-only check, no spoofable headers.
    // Disabled by default in production (TRUST_LOCAL_NETWORK=false).
    const trustLocal =
      this.config.get<string>('TRUST_LOCAL_NETWORK', 'false') === 'true';

    if (trustLocal && this.isLocalIp(request)) {
      // LAN access — try to resolve agent context if key provided
      const localApiKey = request.headers['x-am-api-key'];
      const localUserId = request.headers['x-am-user-id'];
      if (localApiKey && localUserId) {
        try {
          const localApiKeyHash = this.hashApiKey(localApiKey);
          const agent = await this.prisma.agent.findUnique({
            where: { apiKeyHash: localApiKeyHash },
          });
          if (agent && !agent.deletedAt) {
            let user = await this.prisma.user.findUnique({
              where: {
                agentId_externalId: {
                  agentId: agent.id,
                  externalId: localUserId,
                },
              },
            });
            if (!user) {
              user = await this.prisma.user.create({
                data: { agentId: agent.id, externalId: localUserId },
              });
            }
            if (!user.deletedAt) {
              request.agent = agent;
              request.user = user;
              request.accountId = agent.accountId;
            }
          }
        } catch (err) {
          this.logger.warn('LAN auth context resolution failed', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      if (!request.agent) {
        request.agent = null;
        request.user = null;
      }
      return true;
    }

    // Remote access — require API key
    const apiKey = request.headers['x-am-api-key'];
    const userId = request.headers['x-am-user-id'];

    if (!apiKey) {
      throw new UnauthorizedException('Missing X-AM-API-Key header');
    }

    // Default user ID to "default" if not provided — simplifies integrations
    // (Custom GPTs, simple scripts) where multi-user isn't needed
    const resolvedUserId = userId || 'default';

    // Hash the API key for lookup
    const apiKeyHash = this.hashApiKey(apiKey);

    // Validate agent exists
    const agent = await this.prisma.agent.findUnique({
      where: { apiKeyHash },
    });

    if (!agent || agent.deletedAt) {
      throw new UnauthorizedException('Invalid API key');
    }

    // Find or create user
    let user = await this.prisma.user.findUnique({
      where: {
        agentId_externalId: {
          agentId: agent.id,
          externalId: resolvedUserId,
        },
      },
    });

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          agentId: agent.id,
          externalId: resolvedUserId,
        },
      });
    }

    if (user.deletedAt) {
      throw new UnauthorizedException('User has been deleted');
    }

    // Attach to request for use in controllers
    request.agent = agent;
    request.user = user;
    request.accountId = agent.accountId;

    return true;
  }

  /**
   * Check if request originates from a local/LAN IP.
   * Only uses the socket IP — never trusts spoofable headers like Host/Origin.
   * Behind a reverse proxy, set TRUST_LOCAL_NETWORK=false and use API keys.
   */
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

  private hashApiKey(apiKey: string): string {
    return createHash('sha256').update(apiKey).digest('hex');
  }
}
