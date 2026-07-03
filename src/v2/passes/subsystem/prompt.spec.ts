/**
 * Tests for the subsystem-naming prompt (EC-25).
 */

import {
  buildSubsystemPrompt,
  parseSubsystemResponse,
  SUBSYSTEM_SYSTEM_PROMPT,
  type SubsystemPromptInput,
} from './prompt';

function input(over: Partial<SubsystemPromptInput> = {}): SubsystemPromptInput {
  return {
    clusterId: 0,
    members: [
      { modulePath: 'src/auth', intent: 'Handles login + tokens.' },
      { modulePath: 'src/session', intent: 'Tracks session state.' },
    ],
    ...over,
  };
}

describe('buildSubsystemPrompt', () => {
  it('includes the cluster id, module count, and every member path', () => {
    const built = buildSubsystemPrompt(input());
    expect(built.prompt).toContain('Cluster #0');
    expect(built.prompt).toContain('2 module(s)');
    expect(built.prompt).toContain('src/auth');
    expect(built.prompt).toContain('src/session');
    expect(built.prompt).toContain('Handles login');
    expect(built.truncated).toBe(false);
  });

  it('lists members in deterministic (alphabetical path) order', () => {
    const a = buildSubsystemPrompt(
      input({
        members: [
          { modulePath: 'src/zeta' },
          { modulePath: 'src/alpha' },
          { modulePath: 'src/mu' },
        ],
      }),
    );
    const b = buildSubsystemPrompt(
      input({
        members: [
          { modulePath: 'src/alpha' },
          { modulePath: 'src/zeta' },
          { modulePath: 'src/mu' },
        ],
      }),
    );
    expect(a.prompt).toBe(b.prompt);
    // alpha appears before mu appears before zeta
    const idxAlpha = a.prompt.indexOf('src/alpha');
    const idxMu = a.prompt.indexOf('src/mu');
    const idxZeta = a.prompt.indexOf('src/zeta');
    expect(idxAlpha).toBeLessThan(idxMu);
    expect(idxMu).toBeLessThan(idxZeta);
  });

  it('renders top files when supplied', () => {
    const built = buildSubsystemPrompt(
      input({
        members: [
          {
            modulePath: 'src/auth',
            intent: 'auth',
            topFiles: ['src/auth/login.ts', 'src/auth/token.ts'],
          },
        ],
      }),
    );
    expect(built.prompt).toContain('files:');
    expect(built.prompt).toContain('src/auth/login.ts');
  });

  it('marks truncated and drops trailing members when budget is tight', () => {
    const many = Array.from({ length: 200 }, (_, i) => ({
      modulePath: `src/m${i.toString().padStart(3, '0')}`,
      intent: 'A very long intent paragraph repeated many many many many many times. '.repeat(20),
    }));
    const built = buildSubsystemPrompt(
      input({ members: many, maxInputTokens: 800 }),
    );
    expect(built.truncated).toBe(true);
    // some members included, but not all
    expect(built.prompt).toContain('src/m000');
    expect(built.prompt).not.toContain('src/m199');
  });

  it('handles members with no intent gracefully', () => {
    const built = buildSubsystemPrompt(
      input({ members: [{ modulePath: 'src/a' }] }),
    );
    expect(built.prompt).toContain('(no intent recorded)');
  });

  it('exposes the system prompt verbatim on the build result', () => {
    const built = buildSubsystemPrompt(input());
    expect(built.system).toBe(SUBSYSTEM_SYSTEM_PROMPT);
    expect(built.system).toMatch(/JSON/);
    expect(built.system).toMatch(/Title Case/);
  });
});

describe('parseSubsystemResponse', () => {
  it('parses a clean JSON object', () => {
    const raw = JSON.stringify({
      name: 'Auth',
      description: 'Handles login and tokens.',
    });
    const parsed = parseSubsystemResponse(raw);
    expect(parsed).toEqual({
      name: 'Auth',
      description: 'Handles login and tokens.',
    });
  });

  it('tolerates leading/trailing prose and code fences', () => {
    const raw =
      'Sure! Here is your subsystem:\n```json\n' +
      '{"name":"Payment Gateway","description":"Owns Stripe + checkout."}' +
      '\n```\nLet me know if you need anything else.';
    const parsed = parseSubsystemResponse(raw);
    expect(parsed?.name).toBe('Payment Gateway');
    expect(parsed?.description).toBe('Owns Stripe + checkout.');
  });

  it('handles nested braces inside string values', () => {
    const raw = '{"name":"Foo","description":"uses { and } in text"}';
    const parsed = parseSubsystemResponse(raw);
    expect(parsed?.name).toBe('Foo');
    expect(parsed?.description).toBe('uses { and } in text');
  });

  it('returns null for malformed JSON', () => {
    expect(parseSubsystemResponse('not json at all')).toBeNull();
  });

  it('returns null when name is missing or empty', () => {
    expect(parseSubsystemResponse('{"description":"x"}')).toBeNull();
    expect(parseSubsystemResponse('{"name":"","description":"x"}')).toBeNull();
  });

  it('coerces non-string description into empty string still parsable', () => {
    // description omitted entirely → empty string, name still valid
    const parsed = parseSubsystemResponse('{"name":"Auth"}');
    expect(parsed).toEqual({ name: 'Auth', description: '' });
  });

  it('trims whitespace around name and description', () => {
    const parsed = parseSubsystemResponse(
      '{"name":"  Auth  ","description":"  Does things.  "}',
    );
    expect(parsed?.name).toBe('Auth');
    expect(parsed?.description).toBe('Does things.');
  });
});
