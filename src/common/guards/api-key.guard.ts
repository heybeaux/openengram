import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { createHash } from 'crypto';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    
    // Extract headers
    const apiKey = request.headers['x-am-api-key'];
    const userId = request.headers['x-am-user-id'];

    if (!apiKey) {
      throw new UnauthorizedException('Missing X-AM-API-Key header');
    }

    if (!userId) {
      throw new UnauthorizedException('Missing X-AM-User-ID header');
    }

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
          externalId: userId,
        },
      },
    });

    if (!user) {
      // Auto-create user on first request
      user = await this.prisma.user.create({
        data: {
          agentId: agent.id,
          externalId: userId,
        },
      });
    }

    if (user.deletedAt) {
      throw new UnauthorizedException('User has been deleted');
    }

    // Attach to request for use in controllers
    request.agent = agent;
    request.user = user;

    return true;
  }

  private hashApiKey(apiKey: string): string {
    return createHash('sha256').update(apiKey).digest('hex');
  }
}
