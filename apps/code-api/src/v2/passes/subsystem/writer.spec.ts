/**
 * Tests for the subsystem artifact writer (EC-25). fs is stubbed.
 */

import { writeSubsystemArtifacts, type SubsystemArtifactInput } from './writer';

function art(over: Partial<SubsystemArtifactInput> = {}): SubsystemArtifactInput {
  return {
    subsystem: {
      repoId: 'r',
      name: 'Auth',
      slug: 'auth',
      description: 'Handles login.',
      memberModulePaths: ['src/auth', 'src/session'],
    },
    cluster: {
      clusterId: 7,
      tokenCost: 123,
      truncated: false,
      nameFallback: false,
    },
    memberIntents: {
      'src/auth': 'Login + tokens.',
      'src/session': 'Session state.',
    },
    ...over,
  };
}

describe('writeSubsystemArtifacts', () => {
  it('writes one subsystems/<slug>.md per artifact', async () => {
    const writes: Array<{ path: string; contents: string }> = [];
    const dirs: string[] = [];

    const written = await writeSubsystemArtifacts(
      [
        art({
          subsystem: {
            repoId: 'r',
            name: 'Auth',
            slug: 'auth',
            memberModulePaths: ['src/auth'],
          },
        }),
        art({
          subsystem: {
            repoId: 'r',
            name: 'Billing',
            slug: 'billing',
            memberModulePaths: ['src/billing'],
          },
        }),
      ],
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
      '/tmp/.engram/artifacts/subsystems/auth.md',
      '/tmp/.engram/artifacts/subsystems/billing.md',
    ]);
    expect(written.map((w) => w.slug)).toEqual(['auth', 'billing']);
    expect(dirs.every((d) => d.endsWith('/subsystems'))).toBe(true);
    expect(writes[0].path).toBe('/tmp/.engram/artifacts/subsystems/auth.md');
  });

  it('renders YAML frontmatter with cluster + provenance metadata', async () => {
    let written = '';
    await writeSubsystemArtifacts([art()], {
      artifactsRoot: '/x',
      writeFile: async (_p, c) => {
        written = c;
      },
      mkdir: async () => undefined,
    });

    expect(written.startsWith('---\n')).toBe(true);
    expect(written).toContain('subsystem: Auth');
    expect(written).toContain('slug: auth');
    expect(written).toContain('pass: subsystem');
    expect(written).toContain('cluster_id: 7');
    expect(written).toContain('members: 2');
    expect(written).toContain('name_fallback: false');
    expect(written).toContain('truncated: false');
    expect(written).toContain('tokenCost: 123');
  });

  it('renders the markdown body via renderSubsystemMarkdown with member intents', async () => {
    let written = '';
    await writeSubsystemArtifacts([art()], {
      artifactsRoot: '/x',
      writeFile: async (_p, c) => {
        written = c;
      },
      mkdir: async () => undefined,
    });

    expect(written).toContain('## Subsystem: Auth');
    expect(written).toContain('Handles login.');
    expect(written).toContain('`src/auth`');
    expect(written).toContain('Login + tokens.');
    expect(written).toContain('`src/session`');
    expect(written).toContain('Session state.');
  });

  it('uses the member-path list when no member intents are supplied', async () => {
    let written = '';
    await writeSubsystemArtifacts(
      [art({ memberIntents: undefined })],
      {
        artifactsRoot: '/x',
        writeFile: async (_p, c) => {
          written = c;
        },
        mkdir: async () => undefined,
      },
    );

    expect(written).toContain('`src/auth`');
    expect(written).toContain('(no intent recorded)');
  });

  it('surfaces fallback + truncation flags in the frontmatter', async () => {
    let written = '';
    await writeSubsystemArtifacts(
      [
        art({
          cluster: {
            clusterId: 3,
            tokenCost: 0,
            truncated: true,
            nameFallback: true,
          },
        }),
      ],
      {
        artifactsRoot: '/x',
        writeFile: async (_p, c) => {
          written = c;
        },
        mkdir: async () => undefined,
      },
    );

    expect(written).toContain('name_fallback: true');
    expect(written).toContain('truncated: true');
    expect(written).toContain('tokenCost: 0');
  });
});
