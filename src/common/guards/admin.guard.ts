import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Guard that restricts access to admin accounts only.
 * Must be used AFTER AccountJwtGuard (so req.accountId is set).
 * LAN bypass: when TRUST_LOCAL_NETWORK=true and request is local, admin check is skipped.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const accountId = request.accountId;

    // LAN bypass for admin guard
    const trustLocal =
      this.config.get<string>('TRUST_LOCAL_NETWORK', 'false') === 'true';
    if (trustLocal && this.isLocalIp(request)) {
      return true;
    }

    if (!accountId) {
      throw new ForbiddenException('Authentication required');
    }

    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: { isAdmin: true },
    });

    if (!account?.isAdmin) {
      throw new ForbiddenException('Admin access required');
    }

    return true;
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
