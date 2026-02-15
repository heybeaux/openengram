import { Test, TestingModule } from '@nestjs/testing';
import { InstanceController } from './instance.controller';
import { InstanceService } from './instance.service';

describe('InstanceController', () => {
  let controller: InstanceController;
  let service: InstanceService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [InstanceController],
      providers: [InstanceService],
    }).compile();

    controller = module.get<InstanceController>(InstanceController);
    service = module.get<InstanceService>(InstanceService);
  });

  afterEach(() => {
    delete process.env.DEPLOYMENT_MODE;
  });

  it('should return instance info', () => {
    const result = controller.getInfo();
    expect(result).toHaveProperty('mode');
    expect(result).toHaveProperty('version');
    expect(result).toHaveProperty('features');
    expect(result).toHaveProperty('cloudLinked');
  });

  it('should return self-hosted by default', () => {
    delete process.env.DEPLOYMENT_MODE;
    const result = controller.getInfo();
    expect(result.mode).toBe('self-hosted');
  });

  it('should return cloud when env is set', () => {
    process.env.DEPLOYMENT_MODE = 'cloud';
    const result = controller.getInfo();
    expect(result.mode).toBe('cloud');
  });
});
