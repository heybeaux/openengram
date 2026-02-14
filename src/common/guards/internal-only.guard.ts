import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Guard that restricts endpoints to internal/local network access only.
 * These endpoints are not part of the public SaaS API.
 * Only accessible when TRUST_LOCAL_NETWORK=true.
 */
@Injectable()
export class InternalOnlyGuard implements CanActivate {
  constructor(private config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const trustLocal =
      this.config.get<string>('TRUST_LOCAL_NETWORK', 'false') === 'true';

    if (!trustLocal) {
      throw new ForbiddenException(
        'This endpoint is only available in local/self-hosted mode',
      );
    }

    return true;
  }
}
