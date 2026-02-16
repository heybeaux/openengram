import { Test, TestingModule } from '@nestjs/testing';
import { InstanceController } from './instance.controller';
import { InstanceService } from './instance.service';
import { PrismaService } from '../prisma/prisma.service';
import { ApiKeyOrJwtGuard } from '../auth/api-key-or-jwt.guard';

const mockPrisma = {
  cloudLink: { count: jest.fn().mockResolvedValue(0) },
};

describe('InstanceController', () => {
  let controller: InstanceController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [InstanceController],
      providers: [
        InstanceService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    })
      .overrideGuard(ApiKeyOrJwtGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<InstanceController>(InstanceController);
  });

  afterEach(() => {
    delete process.env.DEPLOYMENT_MODE;
  });

  it('should return instance info', async () => {
    const result = await controller.getInfo();
    expect(result).toHaveProperty('mode');
    expect(result).toHaveProperty('version');
    expect(result).toHaveProperty('features');
    expect(result).toHaveProperty('cloudLinked');
  });

  it('should return self-hosted by default', async () => {
    delete process.env.DEPLOYMENT_MODE;
    const result = await controller.getInfo();
    expect(result.mode).toBe('self-hosted');
  });

  it('should return cloud when env is set', async () => {
    process.env.DEPLOYMENT_MODE = 'cloud';
    const result = await controller.getInfo();
    expect(result.mode).toBe('cloud');
  });
});
