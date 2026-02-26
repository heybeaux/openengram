import { FailurePatternService } from '../failure-pattern.service';
import { DelegationContractService } from '../delegation-contract.service';
import { DelegationContract } from '../identity.types';

describe('FailurePatternService', () => {
  let service: FailurePatternService;

  beforeEach(() => {
    service = new FailurePatternService();
  });

  const makeContract = (
    overrides: Partial<DelegationContract> = {},
  ): DelegationContract => ({
    id: `c-${Math.random().toString(36).slice(2, 8)}`,
    delegatedTo: 'agent-1',
    taskDescription: 'Test task',
    expectedOutputs: [],
    successCriteria: [],
    timeout: 60000,
    constraints: [],
    status: 'completed',
    createdAt: new Date(),
    ...overrides,
  });

  describe('analyze', () => {
    it('should detect repeated agent failure patterns', async () => {
      const contractService = {
        getFinalized: jest
          .fn()
          .mockReturnValue([
            makeContract({ delegatedTo: 'bad-agent', status: 'failed' }),
            makeContract({ delegatedTo: 'bad-agent', status: 'failed' }),
            makeContract({ delegatedTo: 'good-agent', status: 'completed' }),
          ]),
      } as unknown as DelegationContractService;

      const patterns = await service.analyze(contractService);

      expect(patterns.length).toBeGreaterThanOrEqual(1);
      const repeated = patterns.find(
        (p) => p.patternType === 'repeated_agent_failure',
      );
      expect(repeated).toBeDefined();
      expect(repeated!.agentId).toBe('bad-agent');
      expect(repeated!.occurrences).toBe(2);
    });

    it('should return no patterns when failures are below threshold', async () => {
      const contractService = {
        getFinalized: jest
          .fn()
          .mockReturnValue([
            makeContract({ delegatedTo: 'agent-1', status: 'failed' }),
            makeContract({ delegatedTo: 'agent-1', status: 'completed' }),
          ]),
      } as unknown as DelegationContractService;

      const patterns = await service.analyze(contractService);

      const repeated = patterns.filter(
        (p) => p.patternType === 'repeated_agent_failure',
      );
      expect(repeated).toHaveLength(0);
    });

    it('should detect timeout patterns', async () => {
      const contractService = {
        getFinalized: jest
          .fn()
          .mockReturnValue([
            makeContract({ delegatedTo: 'slow-agent', status: 'timed_out' }),
            makeContract({ delegatedTo: 'slow-agent', status: 'timed_out' }),
          ]),
      } as unknown as DelegationContractService;

      const patterns = await service.analyze(contractService);

      const timeoutPattern = patterns.find(
        (p) => p.patternType === 'timeout_pattern',
      );
      expect(timeoutPattern).toBeDefined();
      expect(timeoutPattern!.agentId).toBe('slow-agent');
    });

    it('should detect cascading failures across agents', async () => {
      const contractService = {
        getFinalized: jest
          .fn()
          .mockReturnValue([
            makeContract({ delegatedTo: 'agent-a', status: 'failed' }),
            makeContract({ delegatedTo: 'agent-b', status: 'failed' }),
            makeContract({ delegatedTo: 'agent-c', status: 'failed' }),
          ]),
      } as unknown as DelegationContractService;

      const patterns = await service.analyze(contractService);

      const cascade = patterns.find(
        (p) => p.patternType === 'cascading_failure',
      );
      expect(cascade).toBeDefined();
      expect(cascade!.occurrences).toBe(3);
    });

    it('should store insights as INSIGHT memories when createMemoryFn is set', async () => {
      const mockCreateFn = jest.fn().mockResolvedValue({ id: 'insight-1' });
      service.setCreateMemoryFn(mockCreateFn);

      const contractService = {
        getFinalized: jest
          .fn()
          .mockReturnValue([
            makeContract({ delegatedTo: 'bad-agent', status: 'failed' }),
            makeContract({ delegatedTo: 'bad-agent', status: 'failed' }),
          ]),
      } as unknown as DelegationContractService;

      const patterns = await service.analyze(contractService);

      expect(patterns.length).toBeGreaterThanOrEqual(1);
      expect(mockCreateFn).toHaveBeenCalledWith(
        'system',
        expect.objectContaining({
          layer: 'INSIGHT',
          memoryType: 'LESSON',
        }),
      );
    });

    it('should not create duplicate patterns on repeated analyze calls', async () => {
      const contractService = {
        getFinalized: jest
          .fn()
          .mockReturnValue([
            makeContract({ delegatedTo: 'bad-agent', status: 'failed' }),
            makeContract({ delegatedTo: 'bad-agent', status: 'failed' }),
          ]),
      } as unknown as DelegationContractService;

      const first = await service.analyze(contractService);
      const second = await service.analyze(contractService);

      expect(first.length).toBeGreaterThanOrEqual(1);
      expect(second.length).toBe(0); // Already detected
    });
  });
});
