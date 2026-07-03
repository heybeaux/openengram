/**
 * Post-commit hook smoke test (EC-49).
 *
 * Runs `scripts/post-commit-hook.sh` against a one-shot HTTP server that
 * captures the request and asserts:
 *   - POST hits `/v1/ingest/webhook/github`
 *   - `X-GitHub-Event` is `local-commit`
 *   - The payload carries the current HEAD sha
 *   - When `ENGRAM_CODE_WEBHOOK_SECRET` is set, the signature header
 *     matches openssl's HMAC of the body.
 */

import { createHmac } from 'node:crypto';
import { execSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const HOOK_SCRIPT = resolve(
  __dirname,
  '..',
  '..',
  '..',
  'scripts',
  'post-commit-hook.sh',
);

interface CapturedRequest {
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/** Start a one-shot capture server. Resolves with the captured request once the hook hits it. */
function captureOnce(): Promise<{
  port: number;
  awaitRequest: Promise<CapturedRequest>;
  close: () => void;
}> {
  return new Promise((resolveStart) => {
    let resolveReq: (r: CapturedRequest) => void;
    const awaitRequest = new Promise<CapturedRequest>((r) => {
      resolveReq = r;
    });
    const server: Server = createServer((req: IncomingMessage, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c as Buffer));
      req.on('end', () => {
        res.writeHead(202, { 'content-type': 'application/json' });
        res.end('{"ok":true}');
        resolveReq({
          url: req.url,
          headers: req.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      resolveStart({
        port,
        awaitRequest,
        close: () => server.close(),
      });
    });
  });
}

function makeGitRepo(): { dir: string; sha: string } {
  const dir = mkdtempSync(join(tmpdir(), 'ec49-hook-'));
  execSync('git init -q', { cwd: dir });
  execSync('git branch -M main', { cwd: dir });
  execSync('git config user.email test@example.com', { cwd: dir });
  execSync('git config user.name test', { cwd: dir });
  execSync('git config commit.gpgsign false', { cwd: dir });
  execSync('git remote add origin https://github.com/owner/repo.git', {
    cwd: dir,
  });
  writeFileSync(join(dir, 'README.md'), '# hi\n');
  execSync('git add README.md', { cwd: dir });
  execSync('git commit -q -m initial', { cwd: dir });
  const sha = execSync('git rev-parse HEAD', { cwd: dir }).toString().trim();
  return { dir, sha };
}

describe('post-commit-hook.sh', () => {
  const cleanup: string[] = [];

  afterAll(() => {
    for (const d of cleanup) rmSync(d, { recursive: true, force: true });
  });

  it('POSTs a push-shaped payload tagged as local-commit', async () => {
    const repo = makeGitRepo();
    cleanup.push(repo.dir);
    const cap = await captureOnce();

    try {
      const result = spawnSync('bash', [HOOK_SCRIPT], {
        cwd: repo.dir,
        env: {
          ...process.env,
          ENGRAM_CODE_WEBHOOK: `http://127.0.0.1:${cap.port}/v1/ingest/webhook/github`,
          ENGRAM_CODE_WEBHOOK_SECRET: '',
        },
        encoding: 'utf8',
        timeout: 10_000,
      });
      expect(result.status).toBe(0);
      const req = await cap.awaitRequest;
      expect(req.url).toBe('/v1/ingest/webhook/github');
      expect(req.headers['x-github-event']).toBe('local-commit');
      expect(req.headers['x-github-delivery']).toBeDefined();
      const body = JSON.parse(req.body) as {
        ref: string;
        after: string;
        repository: { clone_url: string };
        head_commit: { id: string };
      };
      expect(body.after).toBe(repo.sha);
      expect(body.head_commit.id).toBe(repo.sha);
      expect(body.repository.clone_url).toBe(
        'https://github.com/owner/repo.git',
      );
      expect(body.ref).toBe('refs/heads/main');
    } finally {
      cap.close();
    }
  }, 15_000);

  it('signs the body with HMAC-SHA256 when ENGRAM_CODE_WEBHOOK_SECRET is set', async () => {
    const repo = makeGitRepo();
    cleanup.push(repo.dir);
    const cap = await captureOnce();

    try {
      const result = spawnSync('bash', [HOOK_SCRIPT], {
        cwd: repo.dir,
        env: {
          ...process.env,
          ENGRAM_CODE_WEBHOOK: `http://127.0.0.1:${cap.port}/v1/ingest/webhook/github`,
          ENGRAM_CODE_WEBHOOK_SECRET: 'topsecret',
        },
        encoding: 'utf8',
        timeout: 10_000,
      });
      expect(result.status).toBe(0);
      const req = await cap.awaitRequest;
      const sigHeader = req.headers['x-hub-signature-256'];
      expect(typeof sigHeader).toBe('string');
      const expected =
        'sha256=' +
        createHmac('sha256', 'topsecret').update(req.body).digest('hex');
      expect(sigHeader).toBe(expected);
    } finally {
      cap.close();
    }
  }, 15_000);
});
