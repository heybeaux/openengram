/**
 * EC-27 — integration: prove that a `.engram/config.yaml` placed in a
 * temp "repo" actually overrides the model passed to the intent pass.
 */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { intentOptionsFromConfig, loadConfig } from './index';
import {
  runIntentPass,
  type IntentModuleInput,
} from '../passes/intent/orchestrator';
import type { LLMClient, LLMRequest, LLMResponse } from '../llm/openrouter';

describe('EC-27 config integration', () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await mkdtemp(join(tmpdir(), 'engram-config-int-'));
    await mkdir(join(repoDir, '.git'));
  });

  afterEach(async () => {
    await rm(repoDir, { recursive: true, force: true });
  });

  it('overrides the intent pass model from .engram/config.yaml', async () => {
    const overrideModel = 'anthropic/claude-haiku-4-5';
    const overrideFallback = 'google/gemini-2.5-pro';

    const cfgDir = join(repoDir, '.engram');
    await mkdir(cfgDir);
    await writeFile(
      join(cfgDir, 'config.yaml'),
      [
        'passes:',
        '  intent:',
        `    model: ${overrideModel}`,
        `    fallback: ${overrideFallback}`,
        '    maxInputTokens: 4000',
        '    maxOutputTokens: 500',
        'budget:',
        '  perPassTokenCap: 9000',
        '',
      ].join('\n'),
      'utf8',
    );

    const loaded = await loadConfig({ startDir: repoDir });
    expect(loaded.source).toContain('.engram/config.yaml');

    // Spy on every LLM call so we can assert the routed model.
    const calls: LLMRequest[] = [];
    const llm: LLMClient = (req): Promise<LLMResponse> => {
      calls.push(req);
      return Promise.resolve({
        model: req.model,
        content: 'integration response',
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      });
    };

    const modules: IntentModuleInput[] = [
      {
        modulePath: 'src/sample',
        structure: { nodes: [], edges: [], language: 'typescript' },
        files: [{ path: 'src/sample/index.ts', source: 'export const x = 1;' }],
      },
    ];

    const passOpts = {
      ...intentOptionsFromConfig(loaded.config),
      llm,
    };
    const result = await runIntentPass('test-repo', modules, passOpts);

    expect(result.modules).toHaveLength(1);
    expect(result.modules[0].intent).toBe('integration response');
    expect(calls).toHaveLength(1);
    expect(calls[0].model).toBe(overrideModel);
    expect(calls[0].fallbackModel).toBe(overrideFallback);
    expect(calls[0].maxOutputTokens).toBe(500);
  });
});
