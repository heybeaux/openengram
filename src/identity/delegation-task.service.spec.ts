import { Test, TestingModule } from '@nestjs/testing';
import { DelegationTaskService, LogTaskDto } from './delegation-task.service';
import { FileStoreService } from '../common/persistence/file-store.service';
import { DelegationContractService } from './delegation-contract.service';
import { FailurePatternService } from './failure-pattern.service';

describe('DelegationTaskService', () => {
  let service: DelegationTaskService;
  let fileStore: Partial<FileStoreService>;

  const mockContractService = {
    listAll: jest.fn().mockReturnValue([]),
    getByAgent: jest.fn().mockReturnValue([]),
  } as any;

  const mockPatternService = {
    getPatterns: jest.fn().mockReturnValue([]),
  } as any;

  beforeEach(async () => {
    fileStore = {
      load: jest.fn().mockReturnValue(new Map()),
      save: jest.fn().mockResolvedValue(undefined),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DelegationTaskService,
        { provide: FileStoreService, useValue: fileStore },
        { provide: DelegationContractService, useValue: mockContractService },
        { provide: FailurePatternService, useValue: mockPatternService },
      ],
    }).compile();

    service = module.get(DelegationTaskService);
    service.onModuleInit();

    // Reset mocks to default empty state
    mockContractService.listAll.mockReturnValue([]);
    mockContractService.getByAgent.mockReturnValue([]);
    mockPatternService.getPatterns.mockReturnValue([]);
  });

  const makeDto = (overrides: Partial<LogTaskDto> = {}): LogTaskDto => ({
    sessionKey: 'agent:main:subagent:test',
    task: 'Test task',
    status: 'success',
    durationMs: 5000,
    ...overrides,
  });

  it('should log a task and retrieve it', () => {
    const task = service.logTask(makeDto());
    expect(task.id).toBeDefined();
    expect(task.createdAt).toBeDefined();

    const { tasks, total } = service.getTasks({});
    expect(total).toBe(1);
    expect(tasks[0].id).toBe(task.id);
  });

  it('should FIFO evict at 1000', () => {
    for (let i = 0; i < 1005; i++) {
      service.logTask(makeDto({ task: `Task ${i}` }));
    }
    const { total } = service.getTasks({ limit: 1 });
    expect(total).toBe(1000);
  });

  it('should filter by agentId', () => {
    service.logTask(makeDto({ agentId: 'rook' }));
    service.logTask(makeDto({ agentId: 'other' }));

    const { tasks, total } = service.getTasks({ agentId: 'rook' });
    expect(total).toBe(1);
    expect(tasks[0].agentId).toBe('rook');
  });

  it('should filter by status', () => {
    service.logTask(makeDto({ status: 'success' }));
    service.logTask(makeDto({ status: 'failure', error: 'oops' }));

    const { tasks, total } = service.getTasks({ status: 'failure' });
    expect(total).toBe(1);
    expect(tasks[0].status).toBe('failure');
  });

  it('should filter by since', () => {
    const task = service.logTask(makeDto());
    const future = new Date(Date.now() + 60000).toISOString();

    const { total: before } = service.getTasks({ since: new Date(0).toISOString() });
    expect(before).toBe(1);

    const { total: after } = service.getTasks({ since: future });
    expect(after).toBe(0);
  });

  it('should return recall with contracts, tasks, patterns, and summary', () => {
    mockContractService.listAll.mockReturnValue([{ id: 'c1', task: 'contract task' }]);
    mockPatternService.getPatterns.mockReturnValue([{ pattern: 'test pattern' }]);

    service.logTask(makeDto({ status: 'success', durationMs: 1000 }));
    service.logTask(makeDto({ status: 'failure', durationMs: 3000, error: 'timeout' }));

    const recall = service.getRecall({});
    expect(recall.contracts).toHaveLength(1);
    expect(recall.tasks).toHaveLength(2);
    expect(recall.patterns).toHaveLength(1);
    expect(recall.summary.totalTasks).toBe(2);
    expect(recall.summary.successRate).toBe(0.5);
    expect(recall.summary.avgDurationMs).toBe(2000);
    expect(recall.summary.commonFailures).toContain('timeout');
  });

  it('should compute correct summary stats', () => {
    service.logTask(makeDto({ status: 'success', durationMs: 1000 }));
    service.logTask(makeDto({ status: 'success', durationMs: 2000 }));
    service.logTask(makeDto({ status: 'failure', durationMs: 3000, error: 'err' }));

    const { summary } = service.getRecall({});
    expect(summary.totalTasks).toBe(3);
    expect(summary.successRate).toBeCloseTo(0.6667, 3);
    expect(summary.avgDurationMs).toBe(2000);
  });

  it('should return empty arrays for empty state', () => {
    const recall = service.getRecall({});
    expect(recall.contracts).toEqual([]);
    expect(recall.tasks).toEqual([]);
    expect(recall.patterns).toEqual([]);
    expect(recall.summary.totalTasks).toBe(0);
    expect(recall.summary.successRate).toBe(0);
    expect(recall.summary.avgDurationMs).toBe(0);
    expect(recall.summary.commonFailures).toEqual([]);
  });
});
