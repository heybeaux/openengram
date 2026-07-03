/**
 * Tests for intent artifact writer (EC-22).
 *
 * fs is stubbed — no tmp dir, no disk I/O.
 */

import type { IntentModuleResult } from './orchestrator';
import { writeIntentArtifacts } from './writer';

function result(over: Partial<IntentModuleResult> = {}): IntentModuleResult {
  return {
    modulePath: 'src/auth',
    intent: '## Auth\n\nDoes auth.',
    card: null,
    tokenCost: 200,
    truncated: false,
    ...over,
  };
}

describe('writeIntentArtifacts', () => {
  it('writes one intent.md per successful module under modules/<path>/', async () => {
    const writes: Array<{ path: string; contents: string }> = [];
    const dirs: string[] = [];
    const written = await writeIntentArtifacts(
      [result({ modulePath: 'src/auth' }), result({ modulePath: 'src/billing' })],
      {
        artifactsRoot: '/tmp/.engram/artifacts',
        writeFile: async (p, c) => {
          writes.push({ path: p, contents: c });
        },
        mkdir: async (p) => {
          dirs.push(p as string);
          return undefined;
        },
      },
    );
    expect(written.map((w) => w.filePath)).toEqual([
      '/tmp/.engram/artifacts/modules/src/auth/intent.md',
      '/tmp/.engram/artifacts/modules/src/billing/intent.md',
    ]);
    expect(writes[0].contents).toContain('module: src/auth');
    expect(writes[0].contents).toContain('pass: intent');
    expect(writes[0].contents).toContain('Does auth.');
  });

  it('skips modules with null intent', async () => {
    const writes: string[] = [];
    await writeIntentArtifacts(
      [result({ intent: null, skipReason: 'budget-exceeded' })],
      {
        artifactsRoot: '/x',
        writeFile: async (p) => {
          writes.push(p);
        },
        mkdir: async () => undefined,
      },
    );
    expect(writes).toEqual([]);
  });
});
