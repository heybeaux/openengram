import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Guard that restricts endpoints to internal/local network access only.
 * These endpoints are not part of the public SaaS API.
 * Only accessible when TRUST_LOCAL_NETWORK=true AND request comes from a private IP.
 * Never allowed in production (NODE_ENV=production).
 */
@Injectable()
export class InternalOnlyGuard implements CanActivate {
  private readonly logger = new Logger(InternalOnlyGuard.name);

  constructor(private config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const nodeEnv = this.config.get<string>('NODE_ENV', 'development');

    // Never allow in production, regardless of TRUST_LOCAL_NETWORK
    if (nodeEnv === 'production') {
      throw new ForbiddenException(
        'This endpoint is only available in local/self-hosted mode',
      );
    }

    const trustLocal =
      this.config.get<string>('TRUST_LOCAL_NETWORK', 'false') === 'true';

    if (!trustLocal) {
      throw new ForbiddenException(
        'This endpoint is only available in local/self-hosted mode',
      );
    }

    // Actually verify the request comes from a private/internal IP
    const request = context.switchToHttp().getRequest();
    if (!this.isPrivateIp(request)) {
      this.logger.warn(
        `Blocked non-internal IP from accessing internal-only endpoint: ${this.getIp(request)}`,
      );
      throw new ForbiddenException(
        'This endpoint is only accessible from internal network addresses',
      );
    }

    this.logger.warn(
      'TRUST_LOCAL_NETWORK is enabled — internal-only endpoint accessed. ' +
        'Ensure this is not exposed to untrusted networks.',
    );

    return true;
  }

  private getIp(request: any): string {
    return request.ip || request.connection?.remoteAddress || '';
  }

  private isPrivateIp(request: any): boolean {
    const ip = this.getIp(request);
    return (
      ip === '127.0.0.1' ||
      ip === '::1' ||
      ip === '::ffff:127.0.0.1' ||
      ip.startsWith('10.') ||
      ip.startsWith('192.168.') ||
      ip.startsWith('::ffff:10.') ||
      ip.startsWith('::ffff:192.168.') ||
      this.isIn172PrivateRange(ip)
    );
  }

  private isIn172PrivateRange(ip: string): boolean {
    // Match 172.16.0.0 - 172.31.255.255 and ::ffff: variants
    const raw = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
    if (!raw.startsWith('172.')) return false;
    const second = parseInt(raw.split('.')[1], 10);
    return second >= 16 && second <= 31;
  }
}
