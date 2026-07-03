/**
 * Tests for contracts artifact writer (EC-23). fs is stubbed.
 */

import type { ContractsModuleResult } from './orchestrator';
import { writeContractsArtifacts } from './writer';

function result(over: Partial<ContractsModuleResult> = {}): ContractsModuleResult {
  return {
    modulePath: 'src/auth',
    symbols: [
      {
        name: 'login',
        kind: 'function',
        signature: 'export function login()',
        filePath: 'src/auth/x.ts',
        startLine: 1,
        description: 'Logs in.',
        stability: 'stable',
      },
    ],
    card: {
      repoId: 'r',
      conceptPath: 'r/src/auth',
      lod: 'STANDARD',
      level: 'MODULE',
      content: '## Contracts: src/auth\n\n| login | function | ... |',
      sourcePass: 'contracts',
    },
    tokenCost: 150,
    truncated: false,
    ...over,
  };
}

describe('writeContractsArtifacts', () => {
  it('writes one contracts.md per successful module under modules/<path>/', async () => {
    const writes: Array<{ path: string; contents: string }> = [];
    const dirs: string[] = [];
    const written = await writeContractsArtifacts(
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
      '/tmp/.engram/artifacts/modules/src/auth/contracts.md',
      '/tmp/.engram/artifacts/modules/src/billing/contracts.md',
    ]);
    expect(writes[0].contents).toContain('module: src/auth');
    expect(writes[0].contents).toContain('pass: contracts');
    expect(writes[0].contents).toContain('Contracts: src/auth');
  });

  it('skips modules with null card (e.g. no-symbols, llm-error)', async () => {
    const writes: string[] = [];
    await writeContractsArtifacts(
      [result({ card: null, skipReason: 'no-symbols', symbols: [] })],
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
