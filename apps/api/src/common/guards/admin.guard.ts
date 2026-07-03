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
 * No LAN bypass — admin endpoints always require admin role.
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

    // For self-hosted (LAN bypass), treat the local user as admin
    // Only allow bypass on local edition, not cloud/prod
    const edition = this.config.get<string>('EDITION', 'local');
    const lanBypassEnv = this.config.get<string>('LAN_BYPASS', '');
    const isLocalEdition = edition === 'local' || lanBypassEnv === 'true';
    if (isLocalEdition && request.isLanBypass) {
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
}
