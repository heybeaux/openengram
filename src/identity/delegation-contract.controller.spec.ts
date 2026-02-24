import { Test, TestingModule } from '@nestjs/testing';
import { DelegationContractController } from './delegation-contract.controller';
import { DelegationContractService } from './delegation-contract.service';
import { FileStoreService } from '../common/persistence/file-store.service';
import { ApiKeyOrJwtGuard } from '../common/guards/api-key-or-jwt.guard';

const mockFileStore = {
  load: jest.fn().mockReturnValue(new Map()),
  save: jest.fn().mockResolvedValue(undefined),
  onModuleInit: jest.fn(),
};

describe('DelegationContractController', () => {
  let controller: DelegationContractController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DelegationContractController],
      providers: [DelegationContractService, { provide: FileStoreService, useValue: mockFileStore }],
    })
      .overrideGuard(ApiKeyOrJwtGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(DelegationContractController);
  });

  it('should create a contract', async () => {
    const result = await controller.create({
      taskDescription: 'Test task',
      expectedOutputs: ['output1'],
      successCriteria: ['criteria1'],
      timeout: 5000,
      delegatedTo: 'agent-1',
    });
    expect(result.id).toBeDefined();
    expect(result.status).toBe('pending');
  });

  it('should list contracts', async () => {
    await controller.create({
      taskDescription: 'Task 1',
      expectedOutputs: ['o1'],
      successCriteria: ['c1'],
      timeout: 5000,
      delegatedTo: 'agent-1',
    });
    const list = await controller.list();
    expect(list.length).toBeGreaterThanOrEqual(1);
  });

  it('should get by id', async () => {
    const created = await controller.create({
      taskDescription: 'Task 2',
      expectedOutputs: ['o1'],
      successCriteria: ['c1'],
      timeout: 5000,
      delegatedTo: 'agent-1',
    });
    const found = await controller.getById(created.id);
    expect(found.id).toBe(created.id);
  });

  it('should update status', async () => {
    const created = await controller.create({
      taskDescription: 'Task 3',
      expectedOutputs: ['o1'],
      successCriteria: ['c1'],
      timeout: 5000,
      delegatedTo: 'agent-1',
    });
    const updated = await controller.updateStatus(created.id, {
      status: 'completed',
      result: 'Done',
    });
    expect(updated.status).toBe('completed');
  });
});
