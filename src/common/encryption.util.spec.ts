import { encrypt, decrypt, validateEncryptionKey } from './encryption.util';

describe('encryption.util', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    process.env.ENCRYPTION_KEY = 'test-key-for-encryption-32chars!!';
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  describe('validateEncryptionKey', () => {
    it('should not throw when ENCRYPTION_KEY is set', () => {
      expect(() => validateEncryptionKey()).not.toThrow();
    });

    it('should throw when ENCRYPTION_KEY is missing', () => {
      delete process.env.ENCRYPTION_KEY;
      expect(() => validateEncryptionKey()).toThrow('ENCRYPTION_KEY environment variable is required');
    });

    it('should throw when ENCRYPTION_KEY is the default insecure value', () => {
      process.env.ENCRYPTION_KEY = 'engram-default-encryption-key-change-me';
      expect(() => validateEncryptionKey()).toThrow('ENCRYPTION_KEY environment variable is required');
    });

    it('should throw when ENCRYPTION_KEY is empty string', () => {
      process.env.ENCRYPTION_KEY = '';
      expect(() => validateEncryptionKey()).toThrow('ENCRYPTION_KEY environment variable is required');
    });
  });

  describe('encrypt / decrypt round-trip', () => {
    it('should encrypt and decrypt a simple string', () => {
      const plaintext = 'hello world';
      const encrypted = encrypt(plaintext);
      expect(encrypted).not.toBe(plaintext);
      expect(decrypt(encrypted)).toBe(plaintext);
    });

    it('should encrypt and decrypt empty string', () => {
      const encrypted = encrypt('');
      expect(decrypt(encrypted)).toBe('');
    });

    it('should encrypt and decrypt unicode text', () => {
      const plaintext = '日本語テスト 🎉';
      const encrypted = encrypt(plaintext);
      expect(decrypt(encrypted)).toBe(plaintext);
    });

    it('should encrypt and decrypt long strings', () => {
      const plaintext = 'a'.repeat(10000);
      const encrypted = encrypt(plaintext);
      expect(decrypt(encrypted)).toBe(plaintext);
    });

    it('should produce different ciphertexts for same plaintext (random salt/iv)', () => {
      const plaintext = 'same input';
      const enc1 = encrypt(plaintext);
      const enc2 = encrypt(plaintext);
      expect(enc1).not.toBe(enc2);
      // Both should decrypt to same value
      expect(decrypt(enc1)).toBe(plaintext);
      expect(decrypt(enc2)).toBe(plaintext);
    });
  });

  describe('encrypt output format', () => {
    it('should produce 4-part colon-separated output (salt:iv:encrypted:hmac)', () => {
      const encrypted = encrypt('test');
      const parts = encrypted.split(':');
      expect(parts).toHaveLength(4);
      // Each part should be valid base64
      for (const part of parts) {
        expect(() => Buffer.from(part, 'base64')).not.toThrow();
      }
    });
  });

  describe('decrypt error handling', () => {
    it('should throw on invalid format (1 part)', () => {
      expect(() => decrypt('invaliddata')).toThrow('Invalid encrypted value format');
    });

    it('should throw on invalid format (5 parts)', () => {
      expect(() => decrypt('a:b:c:d:e')).toThrow('Invalid encrypted value format');
    });

    it('should throw on corrupted ciphertext', () => {
      const encrypted = encrypt('test');
      const parts = encrypted.split(':');
      parts[2] = Buffer.from('corrupted').toString('base64');
      expect(() => decrypt(parts.join(':'))).toThrow('HMAC verification failed');
    });

    it('should throw when decrypting with wrong key', () => {
      const encrypted = encrypt('secret');
      process.env.ENCRYPTION_KEY = 'different-key-for-decryption!!!!';
      expect(() => decrypt(encrypted)).toThrow();
    });
  });

  describe('decrypt legacy format (2-part hex)', () => {
    it('should handle 2-part legacy format', () => {
      // Encrypt with legacy format manually to test decryption
      // The legacy format uses hex(iv):hex(encrypted) with static salt
      const crypto = require('crypto');
      const passphrase = process.env.ENCRYPTION_KEY!;
      const salt = 'engram-salt';
      const derivedKey = crypto.scryptSync(passphrase, salt, 32);
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-cbc', derivedKey, iv);
      const encrypted = Buffer.concat([
        cipher.update('legacy test', 'utf8'),
        cipher.final(),
      ]);
      const legacyEncrypted = iv.toString('hex') + ':' + encrypted.toString('hex');

      expect(decrypt(legacyEncrypted)).toBe('legacy test');
    });
  });
});
