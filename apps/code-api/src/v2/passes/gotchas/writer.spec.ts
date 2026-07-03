/**
 * Tests for gotchas artifact writer (EC-24). fs is stubbed.
 */

import type { GotchasModuleResult } from './orchestrator';
import { writeGotchasArtifacts } from './writer';

function result(over: Partial<GotchasModuleResult> = {}): GotchasModuleResult {
  return {
    modulePath: 'src/auth',
    candidateCount: 3,
    gotchas: '- watch out',
    card: {
      repoId: 'r',
      conceptPath: 'r/src/auth',
      lod: 'STANDARD',
      level: 'MODULE',
      content: '## Gotchas: src/auth\n\n- watch out',
      sourcePass: 'gotchas',
    },
    tokenCost: 150,
    truncated: false,
    ...over,
  };
}

describe('writeGotchasArtifacts', () => {
  it('writes one gotchas.md per successful module', async () => {
    const writes: Array<{ path: string; contents: string }> = [];
    const written = await writeGotchasArtifacts(
      [result({ modulePath: 'src/auth' }), result({ modulePath: 'src/billing' })],
      {
        artifactsRoot: '/tmp/.engram/artifacts',
        writeFile: async (p, c) => {
          writes.push({ path: p, contents: c });
        },
        mkdir: async () => undefined,
      },
    );
    expect(written.map((w) => w.filePath)).toEqual([
      '/tmp/.engram/artifacts/modules/src/auth/gotchas.md',
      '/tmp/.engram/artifacts/modules/src/billing/gotchas.md',
    ]);
    expect(writes[0].contents).toContain('module: src/auth');
    expect(writes[0].contents).toContain('pass: gotchas');
    expect(writes[0].contents).toContain('candidates: 3');
  });

  it('skips modules with null card (no-candidates, call-cap, llm-error)', async () => {
    const writes: string[] = [];
    await writeGotchasArtifacts(
      [
        result({ card: null, skipReason: 'no-candidates', gotchas: null, candidateCount: 0 }),
        result({ card: null, skipReason: 'call-cap', gotchas: null }),
      ],
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
