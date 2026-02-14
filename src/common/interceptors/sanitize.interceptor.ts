import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { sanitizeMemoryOutput } from '../../utils/html-sanitize';

/**
 * Interceptor that escapes HTML in memory 'raw' fields on output
 * to prevent stored XSS attacks.
 */
@Injectable()
export class SanitizeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(map((data) => sanitizeMemoryOutput(data)));
  }
}
