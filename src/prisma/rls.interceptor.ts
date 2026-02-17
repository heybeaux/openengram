import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, from, switchMap } from 'rxjs';
import { PrismaService } from './prisma.service';
import { ConfigService } from '@nestjs/config';
import { rlsContext } from './rls-context';

/**
 * RLS Interceptor: Wraps each HTTP request in a Prisma interactive transaction
 * that sets `app.current_account_id` via SET LOCAL. This ensures all queries
 * within the request are filtered by RLS policies.
 *
 * For LAN bypass mode (TRUST_LOCAL_NETWORK=true with no auth), the interceptor
 * skips setting the session variable, and the BYPASSRLS role handles access.
 *
 * Usage: Applied globally or per-controller via @UseInterceptors(RlsInterceptor)
 */
@Injectable()
export class RlsInterceptor implements NestInterceptor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();

    // Resolve accountId: from JWT auth or from agent (API key auth)
    const accountId =
      request.accountId || request.agent?.accountId || null;

    // Skip RLS wrapping when:
    // 1. No accountId (LAN bypass mode / unauthenticated local access)
    // 2. LAN bypass is enabled and no auth context
    if (!accountId) {
      return next.handle();
    }

    // Wrap the request handler in an interactive transaction with SET LOCAL
    return from(
      this.prisma.$transaction(async (tx) => {
        // Switch to non-BYPASSRLS role so RLS policies are enforced.
        // The postgres role has BYPASSRLS which overrides all policies.
        // SET LOCAL ROLE only persists within this transaction.
        await tx.$executeRawUnsafe(`SET LOCAL ROLE app`);

        // SET LOCAL only persists within this transaction
        // SET LOCAL doesn't support parameterized values — use $executeRawUnsafe
        // accountId is always from our own auth resolution, never user input
        const sanitized = accountId.replace(/[^a-zA-Z0-9_-]/g, '');
        await tx.$executeRawUnsafe(`SET LOCAL app.current_account_id = '${sanitized}'`);

        // Store the transactional client on the request (legacy)
        request.prismaTransaction = tx;

        // Run the handler inside AsyncLocalStorage so PrismaService
        // automatically delegates to this transactional client
        return rlsContext.run(tx as any, () => {
          return new Promise((resolve, reject) => {
            next.handle().subscribe({
              next: (val) => resolve(val),
              error: (err: unknown) => reject(err instanceof Error ? err : new Error(String(err))),
            });
          });
        });
      }),
    ).pipe(switchMap((result) => from(Promise.resolve(result))));
  }
}
