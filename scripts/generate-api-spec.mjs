/**
 * Generate static OpenAPI spec from the built NestJS app.
 * Requires `pnpm build` first.
 * Usage: node scripts/generate-api-spec.mjs
 */
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// SWC outputs to dist/ (flat), tsc outputs to dist/src/ (nested)
let AppModule;
try {
  ({ AppModule } = await import('../dist/src/app.module.js'));
} catch {
  ({ AppModule } = await import('../dist/app.module.js'));
}

const app = await NestFactory.create(AppModule, { logger: false });

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
