/**
 * Generate route constants from api-spec.json for the dashboard.
 * Usage: node scripts/generate-routes.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const specPath = path.join(__dirname, '..', 'api-spec.json');

if (!fs.existsSync(specPath)) {
  console.error('api-spec.json not found. Run `pnpm api:spec` first.');
  process.exit(1);
}

const spec = JSON.parse(fs.readFileSync(specPath, 'utf-8'));
const routes = Object.keys(spec.paths || {}).sort();

function toConstName(route) {
  return route
    .replace(/^\//, '')
    .replace(/[{}:]/g, '')
    .replace(/\//g, '_')
    .replace(/-/g, '_')
    .replace(/__+/g, '_')
    .replace(/_$/, '')
    .toUpperCase();
}

const lines = [
  '// Auto-generated from api-spec.json — do not edit manually',
  `// Generated at ${new Date().toISOString()}`,
  '',
  'export const API_ROUTES = {',
];

for (const route of routes) {
  lines.push(`  ${toConstName(route)}: '${route}',`);
}

lines.push('} as const;');
lines.push('');
lines.push('export type ApiRoute = (typeof API_ROUTES)[keyof typeof API_ROUTES];');
lines.push('');

const outDir = path.join(__dirname, '..', 'shared');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const outPath = path.join(outDir, 'api-routes.ts');
fs.writeFileSync(outPath, lines.join('\n'));
console.log(`Route constants written to ${outPath}`);
