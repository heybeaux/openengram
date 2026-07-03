import { Logger } from '@nestjs/common';

const logger = new Logger('Sentry');
import * as Sentry from '@sentry/nestjs';

export function initSentry() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    logger.log('Sentry DSN not configured — error tracking disabled');
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  });

  logger.log('Sentry initialized');
}
