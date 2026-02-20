import {
  validateWebhookUrl,
  validateWebhookUrlSync,
  WebhookUrlValidationError,
} from './url-validator';
import * as dns from 'dns/promises';

jest.mock('dns/promises');
const mockLookup = dns.lookup as jest.MockedFunction<typeof dns.lookup>;

describe('WebhookUrlValidator', () => {
  describe('validateWebhookUrlSync', () => {
    it('allows valid https URL', () => {
      expect(() =>
        validateWebhookUrlSync('https://example.com/webhook'),
      ).not.toThrow();
    });

    it('allows valid http URL', () => {
      expect(() =>
        validateWebhookUrlSync('http://example.com/webhook'),
      ).not.toThrow();
    });

    it('rejects file:// scheme', () => {
      expect(() =>
        validateWebhookUrlSync('file:///etc/passwd'),
      ).toThrow(WebhookUrlValidationError);
    });

    it('rejects ftp:// scheme', () => {
      expect(() =>
        validateWebhookUrlSync('ftp://example.com'),
      ).toThrow(WebhookUrlValidationError);
    });

    it('rejects invalid URL', () => {
      expect(() => validateWebhookUrlSync('not-a-url')).toThrow(
        WebhookUrlValidationError,
      );
    });

    it('rejects localhost IP', () => {
      expect(() =>
        validateWebhookUrlSync('http://127.0.0.1/hook'),
      ).toThrow(WebhookUrlValidationError);
    });

    it('rejects 10.x.x.x', () => {
      expect(() =>
        validateWebhookUrlSync('http://10.0.0.1/hook'),
      ).toThrow(WebhookUrlValidationError);
    });

    it('rejects 172.16.x.x', () => {
      expect(() =>
        validateWebhookUrlSync('http://172.16.0.1/hook'),
      ).toThrow(WebhookUrlValidationError);
    });

    it('rejects 192.168.x.x', () => {
      expect(() =>
        validateWebhookUrlSync('http://192.168.1.1/hook'),
      ).toThrow(WebhookUrlValidationError);
    });

    it('rejects 169.254.x.x (link-local / metadata)', () => {
      expect(() =>
        validateWebhookUrlSync('http://169.254.169.254/latest/meta-data'),
      ).toThrow(WebhookUrlValidationError);
    });
  });

  describe('validateWebhookUrl (async, with DNS)', () => {
    afterEach(() => jest.resetAllMocks());

    it('allows URL resolving to public IP', async () => {
      mockLookup.mockResolvedValue([
        { address: '93.184.216.34', family: 4 },
      ] as any);
      await expect(
        validateWebhookUrl('https://example.com/webhook'),
      ).resolves.toBeUndefined();
    });

    it('rejects URL resolving to 127.0.0.1', async () => {
      mockLookup.mockResolvedValue([
        { address: '127.0.0.1', family: 4 },
      ] as any);
      await expect(
        validateWebhookUrl('https://evil.example.com/hook'),
      ).rejects.toThrow(WebhookUrlValidationError);
    });

    it('rejects URL resolving to 169.254.169.254 (AWS metadata)', async () => {
      mockLookup.mockResolvedValue([
        { address: '169.254.169.254', family: 4 },
      ] as any);
      await expect(
        validateWebhookUrl('https://metadata.example.com'),
      ).rejects.toThrow(WebhookUrlValidationError);
    });

    it('rejects URL resolving to ::1 (IPv6 loopback)', async () => {
      mockLookup.mockResolvedValue([
        { address: '::1', family: 6 },
      ] as any);
      await expect(
        validateWebhookUrl('https://ipv6-loopback.example.com'),
      ).rejects.toThrow(WebhookUrlValidationError);
    });

    it('rejects URL resolving to fc00:: (IPv6 private)', async () => {
      mockLookup.mockResolvedValue([
        { address: 'fc00::1', family: 6 },
      ] as any);
      await expect(
        validateWebhookUrl('https://private-ipv6.example.com'),
      ).rejects.toThrow(WebhookUrlValidationError);
    });

    it('rejects if any resolved address is private', async () => {
      mockLookup.mockResolvedValue([
        { address: '93.184.216.34', family: 4 },
        { address: '10.0.0.1', family: 4 },
      ] as any);
      await expect(
        validateWebhookUrl('https://dual.example.com'),
      ).rejects.toThrow(WebhookUrlValidationError);
    });

    it('rejects DNS resolution failure', async () => {
      mockLookup.mockRejectedValue(new Error('ENOTFOUND'));
      await expect(
        validateWebhookUrl('https://nonexistent.example.com'),
      ).rejects.toThrow(WebhookUrlValidationError);
    });

    it('rejects file:// scheme', async () => {
      await expect(
        validateWebhookUrl('file:///etc/passwd'),
      ).rejects.toThrow(WebhookUrlValidationError);
    });

    it('allows IP literal that is public', async () => {
      await expect(
        validateWebhookUrl('https://93.184.216.34/hook'),
      ).resolves.toBeUndefined();
      expect(mockLookup).not.toHaveBeenCalled();
    });

    it('rejects IP literal that is private', async () => {
      await expect(
        validateWebhookUrl('http://192.168.1.1/hook'),
      ).rejects.toThrow(WebhookUrlValidationError);
      expect(mockLookup).not.toHaveBeenCalled();
    });
  });
});
