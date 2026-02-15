import { InstanceService } from './instance.service';

const mockPrisma = {
  cloudLink: {
    count: jest.fn().mockResolvedValue(0),
  },
};

describe('InstanceService', () => {
  let service: InstanceService;

  beforeEach(() => {
    mockPrisma.cloudLink.count.mockResolvedValue(0);
    service = new InstanceService(mockPrisma as any);
  });

  afterEach(() => {
    delete process.env.DEPLOYMENT_MODE;
  });

  describe('getMode', () => {
    it('should return cloud when DEPLOYMENT_MODE is cloud', () => {
      process.env.DEPLOYMENT_MODE = 'cloud';
      expect(service.getMode()).toBe('cloud');
    });

    it('should return self-hosted by default', () => {
      delete process.env.DEPLOYMENT_MODE;
      expect(service.getMode()).toBe('self-hosted');
    });

    it('should return self-hosted for unknown values', () => {
      process.env.DEPLOYMENT_MODE = 'something-else';
      expect(service.getMode()).toBe('self-hosted');
    });
  });

  describe('isCloudLinked', () => {
    it('should return false when no cloud links exist', async () => {
      mockPrisma.cloudLink.count.mockResolvedValue(0);
      expect(await service.isCloudLinked()).toBe(false);
    });

    it('should return true when cloud links exist', async () => {
      mockPrisma.cloudLink.count.mockResolvedValue(1);
      expect(await service.isCloudLinked()).toBe(true);
    });

    it('should return false in cloud mode', async () => {
      process.env.DEPLOYMENT_MODE = 'cloud';
      expect(await service.isCloudLinked()).toBe(false);
    });
  });

  describe('getFeatures', () => {
    it('should return cloud features', () => {
      const features = service.getFeatures('cloud', false);
      expect(features).toEqual({
        localEmbeddings: false,
        cloudEnsemble: true,
        codeSearch: false,
        cloudBackup: true,
        crossDeviceSync: true,
        billing: true,
      });
    });

    it('should return self-hosted features (no link)', () => {
      const features = service.getFeatures('self-hosted', false);
      expect(features).toEqual({
        localEmbeddings: true,
        cloudEnsemble: false,
        codeSearch: true,
        cloudBackup: false,
        crossDeviceSync: false,
        billing: false,
      });
    });

    it('should return self-hosted linked features', () => {
      const features = service.getFeatures('self-hosted', true);
      expect(features).toEqual({
        localEmbeddings: true,
        cloudEnsemble: true,
        codeSearch: true,
        cloudBackup: true,
        crossDeviceSync: true,
        billing: true,
      });
    });
  });

  describe('getInfo', () => {
    it('should return full info object for self-hosted', async () => {
      delete process.env.DEPLOYMENT_MODE;
      const info = await service.getInfo();
      expect(info.mode).toBe('self-hosted');
      expect(info.cloudLinked).toBe(false);
      expect(info.version).toBeDefined();
      expect(info.features.localEmbeddings).toBe(true);
      expect(info.features.cloudEnsemble).toBe(false);
    });

    it('should return full info object for cloud', async () => {
      process.env.DEPLOYMENT_MODE = 'cloud';
      const info = await service.getInfo();
      expect(info.mode).toBe('cloud');
      expect(info.features.localEmbeddings).toBe(false);
      expect(info.features.cloudEnsemble).toBe(true);
    });
  });
});
