import { createHash } from 'crypto';

/**
 * Generate a SHA-256 content hash for dedup purposes.
 * Normalizes by trimming and lowercasing before hashing.
 */
export function generateContentHash(raw: string): string {
  return createHash('sha256').update(raw.trim().toLowerCase()).digest('hex');
}
