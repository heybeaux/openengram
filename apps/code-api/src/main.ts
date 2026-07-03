import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  // EC-49: rawBody is required so the webhook controller can verify the
  // GitHub HMAC signature against the exact bytes GitHub signed.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  
  app.enableCors({
    origin: true,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  
  const port = process.env.PORT || 3002;
  await app.listen(port);
  console.log(`engram-code running on http://localhost:${port}`);
}
bootstrap();
