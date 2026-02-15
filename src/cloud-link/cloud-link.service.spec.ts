import { CloudLinkService } from './cloud-link.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

const mockPrisma = {
  cloudLink: {
    upsert: jest.fn(),
    findUnique: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
};

// Mock fetch
const mockFetch = jest.fn();
global.fetch = mockFetch as any;

describe('CloudLinkService', () => {
  let service: CloudLinkService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CloudLinkService(mockPrisma as any);
  });

  describe('linkCloud', () => {
    it('should validate key and store cloud link', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'cloud-123', email: 'test@example.com', plan: 'PRO' }),
      });
      mockPrisma.cloudLink.upsert.mockResolvedValue({});

      const result = await service.linkCloud('acc-1', 'valid-key');

      expect(result.linked).toBe(true);
      expect(result.plan).toBe('PRO');
      expect(result.email).toBe('test@example.com');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.openengram.ai/v1/auth/me',
        { headers: { 'X-AM-API-Key': 'valid-key' } },
      );
    });

    it('should throw on invalid API key', async () => {
      mockFetch.mockResolvedValue({ ok: false });

      await expect(service.linkCloud('acc-1', 'bad-key')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('unlinkCloud', () => {
    it('should delete existing cloud link', async () => {
      mockPrisma.cloudLink.findUnique.mockResolvedValue({ id: '1' });
      mockPrisma.cloudLink.delete.mockResolvedValue({});

      await service.unlinkCloud('acc-1');
      expect(mockPrisma.cloudLink.delete).toHaveBeenCalledWith({
        where: { accountId: 'acc-1' },
      });
    });

    it('should throw when no link exists', async () => {
      mockPrisma.cloudLink.findUnique.mockResolvedValue(null);

      await expect(service.unlinkCloud('acc-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getStatus', () => {
    it('should return linked status', async () => {
      mockPrisma.cloudLink.findUnique.mockResolvedValue({
        cloudPlan: 'PRO',
        cloudEmail: 'test@example.com',
        lastVerifiedAt: new Date('2026-01-01'),
      });

      const result = await service.getStatus('acc-1');
      expect(result.linked).toBe(true);
      expect(result.plan).toBe('PRO');
    });

    it('should return unlinked status', async () => {
      mockPrisma.cloudLink.findUnique.mockResolvedValue(null);

      const result = await service.getStatus('acc-1');
      expect(result.linked).toBe(false);
    });
  });

  describe('encryption', () => {
    it('should encrypt and decrypt roundtrip', () => {
      // Access private methods via any cast
      const svc = service as any;
      const original = 'my-secret-api-key-12345';
      const encrypted = svc.encrypt(original);
      expect(encrypted).not.toBe(original);
      expect(encrypted).toContain(':');
      const decrypted = svc.decrypt(encrypted);
      expect(decrypted).toBe(original);
    });
  });
});
