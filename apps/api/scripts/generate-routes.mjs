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

// Detect and resolve duplicate constant names.
// When two routes like /a/b-c and /a/b/c collapse to the same key,
// disambiguate by appending a segment-structure hint instead of a numeric suffix.
const routeEntries = routes.map(route => ({ route, name: toConstName(route) }));
const nameCounts = {};
for (const entry of routeEntries) {
  nameCounts[entry.name] = (nameCounts[entry.name] || 0) + 1;
}
for (const entry of routeEntries) {
  if (nameCounts[entry.name] > 1) {
    // Build a suffix from the last segment's original form to keep it readable.
    // e.g. /v1/identity/delegation/recall → _NESTED (sub-resource style)
    //      /v1/identity/delegation-recall → kept as-is (flat/hyphenated style)
    const segments = entry.route.replace(/^\//, '').split('/');
    const lastSeg = segments[segments.length - 1];
    // If the last segment is a simple word (no hyphen) and there are more segments
    // than the non-duplicate version, this is the nested variant.
    const isNested = !lastSeg.includes('-') && segments.length > 3;
    if (isNested) {
      entry.name = entry.name + '_NESTED';
    }
    // Otherwise keep the original name (the hyphenated/flat route gets priority)
  }
}

const lines = [
  '// Auto-generated from api-spec.json — do not edit manually',
  `// Generated at ${new Date().toISOString()}`,
  '',
  'export const API_ROUTES = {',
];

for (const entry of routeEntries) {
  lines.push(`  ${entry.name}: '${entry.route}',`);
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
