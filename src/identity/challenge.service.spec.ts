import { ChallengeService } from './challenge.service';
import { DelegationContract } from './identity.types';

const mockFileStore = {
  load: jest.fn().mockReturnValue(new Map()),
  save: jest.fn().mockResolvedValue(undefined),
} as any;

describe('ChallengeService', () => {
  let service: ChallengeService;

  beforeEach(() => {
    service = new ChallengeService(mockFileStore);
  });

  it('should create a challenge', async () => {
    const challenge = await service.create({
      taskDescription: 'Deploy to production',
      challengeType: 'unsafe',
      reasoning: 'No rollback plan specified',
    });
    expect(challenge.id).toBeDefined();
    expect(challenge.challengeType).toBe('unsafe');
    expect(challenge.reasoning).toBe('No rollback plan specified');
    expect(challenge.resolution).toBeUndefined();
  });

  it('should create a challenge with contractId', async () => {
    const challenge = await service.create({
      contractId: 'contract-1',
      taskDescription: 'Do something risky',
      challengeType: 'unsafe',
      reasoning: 'Too risky',
    });
    expect(challenge.contractId).toBe('contract-1');
  });

  it('should get challenge by id', async () => {
    const challenge = await service.create({
      taskDescription: 'test',
      challengeType: 'underspecified',
      reasoning: 'Missing details',
    });
    const fetched = service.getById(challenge.id);
    expect(fetched.id).toBe(challenge.id);
  });

  it('should throw on missing challenge', () => {
    expect(() => service.getById('nonexistent')).toThrow();
  });

  it('should list all challenges', async () => {
    await service.create({ taskDescription: 'a', challengeType: 'unsafe', reasoning: 'r' });
    await service.create({ taskDescription: 'b', challengeType: 'underspecified', reasoning: 'r' });
    expect(service.listAll()).toHaveLength(2);
  });

  it('should filter challenges by contractId', async () => {
    await service.create({ contractId: 'c1', taskDescription: 'a', challengeType: 'unsafe', reasoning: 'r' });
    await service.create({ contractId: 'c2', taskDescription: 'b', challengeType: 'unsafe', reasoning: 'r' });
    expect(service.listAll({ contractId: 'c1' })).toHaveLength(1);
  });

  it('should resolve a challenge', async () => {
    const challenge = await service.create({
      taskDescription: 'test',
      challengeType: 'unsafe',
      reasoning: 'risky',
    });
    const resolved = await service.resolve(challenge.id, {
      resolution: 'accepted',
      resolvedBy: 'supervisor-agent',
    });
    expect(resolved.resolution).toBe('accepted');
    expect(resolved.resolvedBy).toBe('supervisor-agent');
    expect(resolved.resolvedAt).toBeDefined();
  });

  it('should not allow resolving an already resolved challenge', async () => {
    const challenge = await service.create({
      taskDescription: 'test',
      challengeType: 'unsafe',
      reasoning: 'risky',
    });
    await service.resolve(challenge.id, { resolution: 'accepted', resolvedBy: 'agent' });
    await expect(
      service.resolve(challenge.id, { resolution: 'overridden', resolvedBy: 'agent' }),
    ).rejects.toThrow('already resolved');
  });

  it('should register and retrieve agent profiles', () => {
    service.registerAgentProfile({
      agentId: 'agent-1',
      domains: ['testing', 'deployment'],
      confidenceByDomain: { testing: 0.9, deployment: 0.2 },
    });
    const profile = service.getAgentProfile('agent-1');
    expect(profile).toBeDefined();
    expect(profile!.confidenceByDomain.deployment).toBe(0.2);
  });

  it('should auto-raise challenge when agent confidence is low', async () => {
    service.registerAgentProfile({
      agentId: 'agent-1',
      domains: ['deployment'],
      confidenceByDomain: { deployment: 0.1 },
    });

    const contract: DelegationContract = {
      id: 'contract-1',
      taskDescription: 'Handle deployment pipeline',
      expectedOutputs: ['deployed'],
      successCriteria: ['healthy'],
      timeout: 60000,
      constraints: [],
      delegatedTo: 'agent-1',
      status: 'pending',
      createdAt: new Date(),
    };

    const challenge = await service.autoCheckCapability(contract);
    expect(challenge).not.toBeNull();
    expect(challenge!.challengeType).toBe('capability_mismatch');
    expect(challenge!.contractId).toBe('contract-1');
  });

  it('should not raise challenge when confidence is sufficient', async () => {
    service.registerAgentProfile({
      agentId: 'agent-1',
      domains: ['testing'],
      confidenceByDomain: { testing: 0.9 },
    });

    const contract: DelegationContract = {
      id: 'contract-2',
      taskDescription: 'Run testing suite',
      expectedOutputs: ['report'],
      successCriteria: ['pass'],
      timeout: 60000,
      constraints: [],
      delegatedTo: 'agent-1',
      status: 'pending',
      createdAt: new Date(),
    };

    const challenge = await service.autoCheckCapability(contract);
    expect(challenge).toBeNull();
  });

  it('should not raise challenge when no profile exists', async () => {
    const contract: DelegationContract = {
      id: 'contract-3',
      taskDescription: 'Do something',
      expectedOutputs: [],
      successCriteria: [],
      timeout: 60000,
      constraints: [],
      delegatedTo: 'unknown-agent',
      status: 'pending',
      createdAt: new Date(),
    };

    const challenge = await service.autoCheckCapability(contract);
    expect(challenge).toBeNull();
  });

  it('should support all challenge types', async () => {
    const types = ['unsafe', 'underspecified', 'capability_mismatch', 'resource_constraint'] as const;
    for (const type of types) {
      const c = await service.create({ taskDescription: 't', challengeType: type, reasoning: 'r' });
      expect(c.challengeType).toBe(type);
    }
    expect(service.listAll()).toHaveLength(4);
  });

  it('should support all resolution types', async () => {
    const resolutions = ['accepted', 'overridden', 'modified'] as const;
    for (const resolution of resolutions) {
      const c = await service.create({ taskDescription: 't', challengeType: 'unsafe', reasoning: 'r' });
      const resolved = await service.resolve(c.id, { resolution, resolvedBy: 'agent' });
      expect(resolved.resolution).toBe(resolution);
    }
  });
});
