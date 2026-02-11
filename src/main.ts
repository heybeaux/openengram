import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

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
      'Agent Memory Service — semantic memory storage, retrieval, and management',
    )
    .setVersion('0.8.0')
    .addApiKey(
      { type: 'apiKey', name: 'X-AM-API-Key', in: 'header' },
      'api-key',
    )
    .addTag('Memory', 'Core memory CRUD and recall')
    .addTag('Ensemble', 'Multi-model embedding and RRF fusion')
    .addTag('Graph', 'Knowledge graph extraction and querying')
    .addTag('Dashboard', 'Analytics and visualization data')
    .addTag('Monitoring', 'Health checks and system metrics')
    .addTag('Consolidation', 'Memory consolidation and dream cycle')
    .addTag('Agents', 'Agent self-memory and reflection')
    .addTag('Context', 'Context loading for agent bootstrap')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('v1/docs', app, document);

  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
bootstrap();
