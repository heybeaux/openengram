import { PLAN_LIMITS } from './plan-limits';

describe('PLAN_LIMITS', () => {
  it('should define limits for all plans', () => {
    expect(PLAN_LIMITS.FREE).toBeDefined();
    expect(PLAN_LIMITS.STARTER).toBeDefined();
    expect(PLAN_LIMITS.PRO).toBeDefined();
    expect(PLAN_LIMITS.SCALE).toBeDefined();
  });

  it('should have increasing memory limits', () => {
    expect(PLAN_LIMITS.FREE.memories).toBeLessThan(
      PLAN_LIMITS.STARTER.memories,
    );
    expect(PLAN_LIMITS.STARTER.memories).toBeLessThan(PLAN_LIMITS.PRO.memories);
    expect(PLAN_LIMITS.PRO.memories).toBeLessThan(PLAN_LIMITS.SCALE.memories);
  });

  it('should have increasing API call limits', () => {
    expect(PLAN_LIMITS.FREE.apiCallsPerDay).toBeLessThan(
      PLAN_LIMITS.STARTER.apiCallsPerDay,
    );
    expect(PLAN_LIMITS.STARTER.apiCallsPerDay).toBeLessThan(
      PLAN_LIMITS.PRO.apiCallsPerDay,
    );
  });

  it('FREE plan should have no ensemble models', () => {
    expect(PLAN_LIMITS.FREE.ensembleModels).toBe(0);
  });

  it('SCALE plan should have unlimited agents (-1)', () => {
    expect(PLAN_LIMITS.SCALE.agents).toBe(-1);
    expect(PLAN_LIMITS.SCALE.usersPerAgent).toBe(-1);
  });

  it('all plans should have required fields', () => {
    for (const plan of Object.values(PLAN_LIMITS)) {
      expect(plan).toHaveProperty('memories');
      expect(plan).toHaveProperty('apiCallsPerDay');
      expect(plan).toHaveProperty('agents');
      expect(plan).toHaveProperty('usersPerAgent');
      expect(plan).toHaveProperty('ensembleModels');
    }
  });
});
