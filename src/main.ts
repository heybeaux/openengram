import { NestFactory } from '@nestjs/core';
import { HttpAdapterHost } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { initSentry } from './common/sentry';
import { SentryExceptionFilter } from './common/sentry-exception.filter';

// Initialize Sentry before anything else
initSentry();

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    bufferLogs: true,
  });

  // Trust Railway's reverse proxy so request.ip returns the real client IP
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.set('trust proxy', true);

  // Use Pino logger
  app.useLogger(app.get(Logger));

  // Sentry global exception filter
  const { httpAdapter } = app.get(HttpAdapterHost);
  app.useGlobalFilters(new SentryExceptionFilter(httpAdapter));

  // Security headers (HSTS, X-Content-Type-Options, X-Frame-Options, hides X-Powered-By)
  // Relax CSP for the memory-graph static page (needs inline scripts/styles + d3 CDN)
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://d3js.org"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        fontSrc: ["'self'", "https:", "data:"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'self'", "https://openengram.ai", "https://app.openengram.ai", "https://*.vercel.app"],
      },
    },
  }));

  // Enable global validation pipe with transform
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false, // Allow legacy fields for backward compatibility
    }),
  );

  // CORS whitelist — configurable via CORS_ORIGINS env var (comma-separated)
  const allowedOrigins = (() => {
    const envOrigins = process.env.CORS_ORIGINS;
    if (envOrigins) {
      return envOrigins
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean);
    }
    const origins = [
      'https://openengram.ai',
      'https://www.openengram.ai',
      'https://app.openengram.ai',
    ];
    if (process.env.NODE_ENV !== 'production') {
      origins.push('http://localhost:3000');
    }
    return origins;
  })();

  app.enableCors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: [
      'Content-Type',
      'X-AM-API-Key',
      'X-AM-User-ID',
      'x-api-key',
      'Authorization',
    ],
  });

  // Swagger / OpenAPI documentation
  const config = new DocumentBuilder()
    .setTitle('Engram API')
    .setDescription('Memory infrastructure for AI agents that actually works.')
    .setVersion('1.0.0')
    .addApiKey(
      { type: 'apiKey', name: 'X-AM-API-Key', in: 'header' },
      'api-key',
    )
    .addApiKey(
      { type: 'apiKey', name: 'X-AM-User-ID', in: 'header' },
      'user-id',
    )
    .addTag('memories', 'Core memory operations')
    .addTag('search', 'Semantic search and recall')
    .addTag('context', 'Context generation')
    .addTag('dedup', 'Deduplication management')
    .addTag('health', 'Health and monitoring')
    .addTag('webhooks', 'Webhook subscriptions')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
bootstrap();
