import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  HttpException,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { MonitoringService } from './monitoring.service';

/**
 * Interceptor that tracks 5xx errors for monitoring.
 * Apply globally in main.ts or per-module.
 */
@Injectable()
export class MonitoringInterceptor implements NestInterceptor {
  constructor(private readonly monitoring: MonitoringService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const path = request.url || request.path || 'unknown';

    return next.handle().pipe(
      catchError((err) => {
        const status =
          err instanceof HttpException ? err.getStatus() : 500;
        if (status >= 500) {
          this.monitoring.recordApiError(status, path);
        }
        return throwError(() => err);
      }),
    );
  }
}
