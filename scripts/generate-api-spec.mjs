/**
 * Generate static OpenAPI spec from the built NestJS app.
 * Requires `pnpm build` first.
 * Usage: node scripts/generate-api-spec.mjs
 */

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err.message);
  console.error(err.stack);
  process.exit(1);
});

process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED REJECTION:', err);
  process.exit(1);
});

console.log('Starting API spec generation...');

import('fs').then(async (fsModule) => {
  const fs = fsModule.default;
  const path = (await import('path')).default;
  const { fileURLToPath } = await import('url');
  const __dirname = path.dirname(fileURLToPath(import.meta.url));

  console.log('Importing NestJS modules...');
  const { NestFactory } = await import('@nestjs/core');
  const { SwaggerModule, DocumentBuilder } = await import('@nestjs/swagger');

  console.log('Importing AppModule...');
  let AppModule;
  try {
    ({ AppModule } = await import('../dist/src/app.module.js'));
    console.log('Loaded from dist/src/');
  } catch (e1) {
    try {
      ({ AppModule } = await import('../dist/app.module.js'));
      console.log('Loaded from dist/');
    } catch (e2) {
      console.error('Failed to import AppModule:');
      console.error('  dist/src/ error:', e1.message);
      console.error('  dist/ error:', e2.message);
      process.exit(1);
    }
  }

  console.log('Creating NestJS app...');
  const app = await NestFactory.create(AppModule, { logger: false });

  console.log('Generating Swagger document...');
  const config = new DocumentBuilder()
    .setTitle('Engram API')
    .setDescription('Memory infrastructure for AI agents')
    .setVersion('2.0')
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', name: 'X-AM-API-Key', in: 'header' }, 'api-key')
    .addApiKey({ type: 'apiKey', name: 'X-AM-User-ID', in: 'header' }, 'user-id')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  const outPath = path.join(__dirname, '..', 'api-spec.json');
  fs.writeFileSync(outPath, JSON.stringify(document, null, 2) + '\n');
  console.log(`OpenAPI spec written to ${outPath}`);

  await app.close();
  process.exit(0);
}).catch((err) => {
  console.error('FATAL:', err.message);
  console.error(err.stack);
  process.exit(1);
});
