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

    if (!syncKey) {
      throw new UnauthorizedException('Missing X-Sync-Key header');
    }

    const keyHash = createHash('sha256').update(syncKey).digest('hex');

    const instanceSyncKey = await this.prisma.instanceSyncKey.findUnique({
      where: { keyHash },
    });

    if (!instanceSyncKey || instanceSyncKey.revokedAt) {
      throw new UnauthorizedException('Invalid or revoked sync key');
    }

    // Update lastUsedAt (best-effort, don't block on it)
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
}
