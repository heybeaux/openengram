import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // Enable global validation pipe with transform
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false, // Allow legacy fields for backward compatibility
    }),
  );

  // Enable CORS for dashboard and visualization
  app.enableCors({
    origin: true, // Allow all origins (including file://)
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
    .setDescription(
      'Memory infrastructure for AI agents that actually works.',
    )
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
