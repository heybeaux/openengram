/**
 * GitHub URL parsing for the ingest flow (EC-39a).
 *
 * Accepts the three common forms users paste:
 *   - https://github.com/<owner>/<repo>
 *   - https://github.com/<owner>/<repo>.git
 *   - https://github.com/<owner>/<repo>/tree/<ref>/...
 *
 * Returns `null` for anything that isn't a public github.com repo URL —
 * other hosts, ssh forms, and gist/api paths are intentionally rejected
 * to keep the ingest surface narrow.
 */

export interface ParsedGitHubUrl {
  owner: string;
  repo: string;
  /** Optional branch/ref captured from `/tree/<ref>` segments. */
  ref?: string;
  /** The canonical clone URL the worker should hand to `git clone`. */
  cloneUrl: string;
  /** Stable repoId for artifacts namespacing — `<owner>__<repo>`. */
  repoId: string;
}

const REPO_NAME_RE = /^[A-Za-z0-9._-]+$/;

export function parseGitHubUrl(raw: string): ParsedGitHubUrl | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') {
    return null;
  }
  const segments = url.pathname
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s !== '');
  if (segments.length < 2) return null;

  const owner = segments[0];
  let repo = segments[1];
  if (repo.endsWith('.git')) repo = repo.slice(0, -4);

  if (!REPO_NAME_RE.test(owner) || !REPO_NAME_RE.test(repo)) return null;

  // Optional /tree/<ref>/...
  let ref: string | undefined;
  if (segments.length >= 4 && segments[2] === 'tree') {
    const candidate = segments[3];
    if (candidate && /^[A-Za-z0-9._\/-]+$/.test(candidate)) {
      ref = candidate;
    }
  }

  return {
    owner,
    repo,
    ref,
    cloneUrl: `https://github.com/${owner}/${repo}.git`,
    repoId: `${owner}__${repo}`,
  };
}
