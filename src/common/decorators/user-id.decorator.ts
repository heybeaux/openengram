import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Extracts the internal user ID from the request
 * (set by ApiKeyGuard after validating X-AM-User-ID)
 */
export const UserId = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    return request.user?.id;
  },
);

/**
 * Extracts the agent from the request
 */
export const Agent = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.agent;
  },
);
