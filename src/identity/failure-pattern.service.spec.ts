import { FailurePatternService } from './failure-pattern.service';
import { DelegationContractService } from './delegation-contract.service';

const mockFileStore = {
  load: jest.fn().mockReturnValue(new Map()),
  save: jest.fn().mockResolvedValue(undefined),
} as any;

describe('FailurePatternService', () => {
  let service: FailurePatternService;
  let contractService: DelegationContractService;
  let createMemoryFn: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    service = new FailurePatternService();
    contractService = new DelegationContractService(mockFileStore);
    createMemoryFn = jest.fn().mockResolvedValue({ id: 'mem-1' });
    service.setCreateMemoryFn(createMemoryFn);
    contractService.setCreateMemoryFn(
      jest.fn().mockResolvedValue({ id: 'mem-x' }),
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  async function createAndFail(agentId: string, task: string) {
    const c = await contractService.create({
      taskDescription: task,
      expectedOutputs: ['output'],
      successCriteria: ['pass'],
      timeout: 999999,
      delegatedTo: agentId,
    });
    await contractService.complete(c.id, { status: 'failed', result: 'error' });
    return c;
  }

  async function createAndTimeout(agentId: string, task: string) {
    const c = await contractService.create({
      taskDescription: task,
      expectedOutputs: ['output'],
      successCriteria: ['pass'],
      timeout: 0.1,
      delegatedTo: agentId,
    });
    jest.advanceTimersByTime(200);
    await Promise.resolve();
    await Promise.resolve();
    return c;
  }

  it('should detect repeated failures by same agent', async () => {
    await createAndFail('agent-1', 'task A');
    await createAndFail('agent-1', 'task B');

    const patterns = await service.analyze(contractService);
    expect(patterns).toHaveLength(1);
    expect(patterns[0].patternType).toBe('repeated_agent_failure');
    expect(patterns[0].agentId).toBe('agent-1');
    expect(patterns[0].occurrences).toBe(2);
  });

  it('should not detect pattern with insufficient failures', async () => {
    await createAndFail('agent-1', 'task A');
    const patterns = await service.analyze(contractService);
    expect(patterns).toHaveLength(0);
  });

  it('should detect timeout patterns', async () => {
    await createAndTimeout('agent-2', 'task A');
    await createAndTimeout('agent-2', 'task B');

    const patterns = await service.analyze(contractService);
    const timeoutPatterns = patterns.filter(
      (p) => p.patternType === 'timeout_pattern',
    );
    expect(timeoutPatterns).toHaveLength(1);
    expect(timeoutPatterns[0].agentId).toBe('agent-2');
  });

  it('should detect cascading failures across agents', async () => {
    await createAndFail('agent-1', 'task A');
    await createAndFail('agent-2', 'task B');
    await createAndFail('agent-3', 'task C');

    const patterns = await service.analyze(contractService);
    const cascading = patterns.filter(
      (p) => p.patternType === 'cascading_failure',
    );
    expect(cascading).toHaveLength(1);
    expect(cascading[0].agentId).toBe('multiple');
    expect(cascading[0].occurrences).toBe(3);
  });

  it('should store patterns as INSIGHT memories', async () => {
    await createAndFail('agent-1', 'task A');
    await createAndFail('agent-1', 'task B');

    await service.analyze(contractService);
    expect(createMemoryFn).toHaveBeenCalledWith(
      'system',
      expect.objectContaining({
        layer: 'INSIGHT',
        memoryType: 'LESSON',
        source: 'SYSTEM_GENERATED',
      }),
    );
    expect(createMemoryFn.mock.calls[0][1].raw).toContain(
      'FAILURE PATTERN DETECTED',
    );
  });

  it('should not duplicate patterns on re-analysis', async () => {
    await createAndFail('agent-1', 'task A');
    await createAndFail('agent-1', 'task B');

    const first = await service.analyze(contractService);
    expect(first).toHaveLength(1);

    const second = await service.analyze(contractService);
    expect(second).toHaveLength(0); // No new patterns

    expect(service.getPatterns()).toHaveLength(1); // Still just one total
  });

  it('should filter patterns by agentId', async () => {
    await createAndFail('agent-1', 'task A');
    await createAndFail('agent-1', 'task B');
    await createAndFail('agent-2', 'task C');
    await createAndFail('agent-2', 'task D');

    await service.analyze(contractService);
    expect(service.getPatterns('agent-1')).toHaveLength(1);
    expect(service.getPatterns('agent-2')).toHaveLength(1);
    expect(service.getPatterns('agent-3')).toHaveLength(0);
  });

  it('should handle no createMemoryFn gracefully', async () => {
    const svc = new FailurePatternService();
    await createAndFail('agent-1', 'task A');
    await createAndFail('agent-1', 'task B');

    // Should not throw
    const patterns = await svc.analyze(contractService);
    expect(patterns).toHaveLength(1);
  });

  it('should include contract IDs in pattern', async () => {
    const c1 = await createAndFail('agent-1', 'task A');
    const c2 = await createAndFail('agent-1', 'task B');

    const patterns = await service.analyze(contractService);
    expect(patterns[0].contractIds).toContain(c1.id);
    expect(patterns[0].contractIds).toContain(c2.id);
  });
});
