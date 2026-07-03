import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { createHash } from 'crypto';

/**
 * Guard for sync endpoints. Authenticates via X-Sync-Key header.
 * Sets request.accountId and request.instanceId.
 * Does NOT set request.agent — sync preserves original agent attribution.
 */
@Injectable()
export class InstanceSyncKeyGuard implements CanActivate {
  private readonly logger = new Logger(InstanceSyncKeyGuard.name);

  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const syncKey = request.headers['x-sync-key'];
    const apiKey = request.headers['x-am-api-key'];

    // Try X-Sync-Key first (esync_ keys from instanceSyncKey table)
    if (syncKey) {
      const keyHash = createHash('sha256').update(syncKey).digest('hex');
      const instanceSyncKey = await this.prisma.instanceSyncKey.findUnique({
        where: { keyHash },
      });

      if (!instanceSyncKey || instanceSyncKey.revokedAt) {
        throw new UnauthorizedException('Invalid or revoked sync key');
      }

      // Update lastUsedAt (best-effort)
      this.prisma.instanceSyncKey
        .update({
          where: { id: instanceSyncKey.id },
          data: { lastUsedAt: new Date() },
        })
        .catch((err) => {
          this.logger.warn(`Failed to update lastUsedAt: ${err.message}`);
        });

      request.accountId = instanceSyncKey.accountId;
      request.instanceId = instanceSyncKey.id;
      request.instanceName = instanceSyncKey.instanceName;
      return true;
    }

    // Fallback: accept eng_inst_ keys (instance API keys with sync scope)
    if (
      apiKey &&
      typeof apiKey === 'string' &&
      apiKey.startsWith('eng_inst_')
    ) {
      const keyHash = createHash('sha256').update(apiKey).digest('hex');
      const instanceApiKey = await this.prisma.instanceApiKey.findUnique({
        where: { keyHash },
      });

      if (!instanceApiKey || instanceApiKey.deletedAt) {
        throw new UnauthorizedException('Invalid instance API key');
      }

      if (!instanceApiKey.scopes?.includes('sync')) {
        throw new UnauthorizedException('Instance API key lacks sync scope');
      }

      // Update lastUsedAt (best-effort)
      this.prisma.instanceApiKey
        .update({
          where: { id: instanceApiKey.id },
          data: { lastUsedAt: new Date() },
        })
        .catch((err) => {
          this.logger.warn(`Failed to update lastUsedAt: ${err.message}`);
        });

      // Use instanceId from X-Instance-Id header or generate from key id
      request.accountId = instanceApiKey.accountId;
      request.instanceId =
        request.headers['x-instance-id'] || instanceApiKey.id;
      request.instanceName = instanceApiKey.name;
      return true;
    }

    throw new UnauthorizedException(
      'Missing X-Sync-Key or X-AM-API-Key header',
    );

    return true;
  }
}
