import { Catch, ArgumentsHost, HttpException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import * as Sentry from '@sentry/nestjs';

@Catch()
export class SentryExceptionFilter extends BaseExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    // Don't report expected HTTP errors (4xx) to Sentry
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status < 500) {
        return super.catch(exception, host);
      }
    }

    Sentry.captureException(exception);
    return super.catch(exception, host);
  }
}
