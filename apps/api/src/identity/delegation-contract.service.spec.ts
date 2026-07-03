import { DelegationContractService } from './delegation-contract.service';
import { ChallengeService } from './challenge.service';
import { CreateContractDto } from './identity.types';

const mockPrisma = {
  identityContract: {
    findMany: jest.fn().mockResolvedValue([]),
    upsert: jest.fn().mockResolvedValue({}),
    create: jest.fn().mockResolvedValue({}),
  },
  identityChallenge: {
    findMany: jest.fn().mockResolvedValue([]),
    upsert: jest.fn().mockResolvedValue({}),
  },
  identityAgentProfile: {
    findMany: jest.fn().mockResolvedValue([]),
    upsert: jest.fn().mockResolvedValue({}),
  },
} as any;

describe('DelegationContractService', () => {
  let service: DelegationContractService;
  let challengeService: ChallengeService;
  let createMemoryFn: jest.Mock;

  const baseDto: CreateContractDto = {
    taskDescription: 'Build a REST API',
    expectedOutputs: ['controller', 'service', 'tests'],
    successCriteria: ['all tests pass', 'endpoints respond'],
    timeout: 60000,
    delegatedTo: 'agent-1',
  };

  beforeEach(() => {
    jest.useFakeTimers();
    service = new DelegationContractService(mockPrisma);
    challengeService = new ChallengeService(mockPrisma);
    service.setChallengeService(challengeService);
    createMemoryFn = jest.fn().mockResolvedValue({ id: 'mem-1' });
    service.setCreateMemoryFn(createMemoryFn);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should create a contract with all fields', async () => {
    const contract = await service.create(baseDto);
    expect(contract.id).toBeDefined();
    expect(contract.taskDescription).toBe('Build a REST API');
    expect(contract.expectedOutputs).toEqual([
      'controller',
      'service',
      'tests',
    ]);
    expect(contract.successCriteria).toEqual([
      'all tests pass',
      'endpoints respond',
    ]);
    expect(contract.timeout).toBe(60000);
    expect(contract.delegatedTo).toBe('agent-1');
    expect(contract.status).toBe('pending');
    expect(contract.constraints).toEqual([]);
  });

  it('should get contract by id', async () => {
    const contract = await service.create(baseDto);
    const fetched = service.getById(contract.id);
    expect(fetched.id).toBe(contract.id);
  });

  it('should throw on missing contract', () => {
    expect(() => service.getById('nonexistent')).toThrow();
  });

  it('should list all contracts', async () => {
    await service.create(baseDto);
    await service.create({ ...baseDto, delegatedTo: 'agent-2' });
    expect(service.listAll()).toHaveLength(2);
  });

  it('should complete a contract successfully', async () => {
    const contract = await service.create(baseDto);
    const completed = await service.complete(contract.id, {
      status: 'completed',
      result: 'All done',
    });
    expect(completed.status).toBe('completed');
    expect(completed.result).toBe('All done');
    expect(completed.completedAt).toBeDefined();
  });

  it('should create TASK_COMPLETION memory on completion', async () => {
    const contract = await service.create(baseDto);
    await service.complete(contract.id, {
      status: 'completed',
      result: 'Done',
    });
    expect(createMemoryFn).toHaveBeenCalledWith(
      'system',
      expect.objectContaining({
        layer: 'TASK',
        memoryType: 'TASK',
        agentId: 'agent-1',
        source: 'SYSTEM_GENERATED',
      }),
    );
    expect(createMemoryFn.mock.calls[0][1].raw).toContain('TASK_COMPLETION');
  });

  it('should fail a contract', async () => {
    const contract = await service.create(baseDto);
    const failed = await service.complete(contract.id, {
      status: 'failed',
      result: 'Error occurred',
    });
    expect(failed.status).toBe('failed');
  });

  it('should not allow completing an already finalized contract', async () => {
    const contract = await service.create(baseDto);
    await service.complete(contract.id, { status: 'completed' });
    await expect(
      service.complete(contract.id, { status: 'failed' }),
    ).rejects.toThrow('already finalized');
  });

  it('should handle timeout', async () => {
    const contract = await service.create({ ...baseDto, timeout: 1 });
    jest.advanceTimersByTime(1500);
    // Allow async timeout handler to run
    await Promise.resolve();
    await Promise.resolve();
    const updated = service.getById(contract.id);
    expect(updated.status).toBe('timed_out');
  });

  it('should create TASK_COMPLETION memory on timeout', async () => {
    await service.create({ ...baseDto, timeout: 1 });
    jest.advanceTimersByTime(1500);
    await Promise.resolve();
    await Promise.resolve();
    expect(createMemoryFn).toHaveBeenCalled();
    expect(createMemoryFn.mock.calls[0][1].raw).toContain('TASK_COMPLETION');
  });

  it('should get contracts by agent', async () => {
    await service.create(baseDto);
    await service.create({ ...baseDto, delegatedTo: 'agent-2' });
    expect(service.getByAgent('agent-1')).toHaveLength(1);
    expect(service.getByAgent('agent-2')).toHaveLength(1);
  });

  it('should get finalized contracts', async () => {
    const c1 = await service.create(baseDto);
    await service.create(baseDto);
    await service.complete(c1.id, { status: 'completed' });
    expect(service.getFinalized()).toHaveLength(1);
  });

  it('should store constraints', async () => {
    const contract = await service.create({
      ...baseDto,
      constraints: ['no database changes', 'max 5 files'],
    });
    expect(contract.constraints).toEqual([
      'no database changes',
      'max 5 files',
    ]);
  });

  it('should auto-check capability on create when challenge service is set', async () => {
    challengeService.registerAgentProfile({
      agentId: 'agent-1',
      domains: ['API'],
      confidenceByDomain: { API: 0.1 },
    });
    const contract = await service.create(baseDto);
    const challenges = challengeService.listAll({ contractId: contract.id });
    expect(challenges).toHaveLength(1);
    expect(challenges[0].challengeType).toBe('capability_mismatch');
  });
});
