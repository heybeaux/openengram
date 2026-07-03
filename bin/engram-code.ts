#!/usr/bin/env node
/**
 * engram-code CLI entrypoint (EC-16).
 *
 * Thin shim around `src/v2/cli/cli.ts` so the runtime behavior stays in
 * a normally-importable module (testable, no shebang/side-effects). This
 * file does exactly two things: forward argv, and translate the resolved
 * exit code into `process.exit`.
 *
 * Run during development via:
 *   npx ts-node bin/engram-code.ts <command> [...]
 *
 * After `nest build`, the compiled JS lives at `dist/bin/engram-code.js`.
 */

import { run } from '../src/v2/cli/cli';

run(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`engram-code: ${(err as Error).stack ?? err}\n`);
    process.exit(70);
  },
);
