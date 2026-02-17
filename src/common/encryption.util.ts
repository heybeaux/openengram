import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from 'crypto';

const ALGORITHM = 'aes-256-cbc';
const LEGACY_SALT = 'engram-salt';

/**
 * Validates that ENCRYPTION_KEY is set. Call at startup.
 * Throws if missing.
 */
export function validateEncryptionKey(): void {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || key === 'engram-default-encryption-key-change-me') {
    throw new Error(
      'ENCRYPTION_KEY environment variable is required. ' +
        'Generate a strong random key (e.g. openssl rand -hex 32) and set it before starting.',
    );
  }
}

function getEncryptionKey(): string {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || key === 'engram-default-encryption-key-change-me') {
    throw new Error(
      'ENCRYPTION_KEY environment variable is not set or is using the insecure default.',
    );
  }
  return key;
}

function deriveKey(passphrase: string, salt: Buffer | string): Buffer {
  return scryptSync(passphrase, salt, 32);
}

/**
 * Encrypt a string using AES-256-CBC with a random per-encryption salt.
 * Output format: base64(salt):base64(iv):base64(encrypted)
 */
export function encrypt(text: string): string {
  const passphrase = getEncryptionKey();
  const salt = randomBytes(16);
  const derivedKey = deriveKey(passphrase, salt);
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, derivedKey, iv);
  const encrypted = Buffer.concat([
    cipher.update(text, 'utf8'),
    cipher.final(),
  ]);
  return [
    salt.toString('base64'),
    iv.toString('base64'),
    encrypted.toString('base64'),
  ].join(':');
}

/**
 * Decrypt a string. Supports both:
 * - New format: base64(salt):base64(iv):base64(encrypted) (3 parts)
 * - Legacy format: hex(iv):hex(encrypted) (2 parts, static salt)
 */
export function decrypt(encrypted: string): string {
  const passphrase = getEncryptionKey();
  const parts = encrypted.split(':');

  if (parts.length === 3) {
    // New format with per-encryption salt
    const salt = Buffer.from(parts[0], 'base64');
    const iv = Buffer.from(parts[1], 'base64');
    const enc = Buffer.from(parts[2], 'base64');
    const derivedKey = deriveKey(passphrase, salt);
    const decipher = createDecipheriv(ALGORITHM, derivedKey, iv);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString(
      'utf8',
    );
  }

  if (parts.length === 2) {
    // Legacy format: hex(iv):hex(encrypted) with static salt
    const iv = Buffer.from(parts[0], 'hex');
    const enc = Buffer.from(parts[1], 'hex');
    const derivedKey = deriveKey(passphrase, LEGACY_SALT);
    const decipher = createDecipheriv(ALGORITHM, derivedKey, iv);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString(
      'utf8',
    );
  }

  throw new Error('Invalid encrypted value format');
}
