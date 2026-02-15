import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Guard that restricts access to admin accounts only.
 * Must be used AFTER AccountJwtGuard (so req.accountId is set).
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const accountId = request.accountId;

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
