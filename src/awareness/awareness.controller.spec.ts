import { AwarenessController } from './awareness.controller';
import { WakingCycleService } from './waking-cycle.service';
import { AwarenessConfig } from './config/awareness.config';

describe('AwarenessController', () => {
  let controller: AwarenessController;
  let wakingCycle: jest.Mocked<WakingCycleService>;

  beforeEach(() => {
    wakingCycle = {
      runCycle: jest.fn(),
      runScheduled: jest.fn(),
    } as any;
  });

  describe('getStatus', () => {
    it('should return status with cycleAvailable true when service exists', () => {
      controller = new AwarenessController(wakingCycle);
      const result = controller.getStatus();

      expect(result).toEqual({
        enabled: AwarenessConfig.enabled,
        schedule: AwarenessConfig.schedule,
        signals: AwarenessConfig.signals,
        github: {
          configured: !!AwarenessConfig.github.token && AwarenessConfig.github.repos.length > 0,
          repos: AwarenessConfig.github.repos,
        },
        cycleAvailable: true,
      });
    });

    it('should return cycleAvailable false when service is undefined', () => {
      controller = new AwarenessController(undefined);
      const result = controller.getStatus();

      expect(result.cycleAvailable).toBe(false);
    });
  });

  describe('triggerCycle', () => {
    it('should run cycle and return results when service is available', async () => {
      const cycleResult = { observations: 5, patterns: 2, insights: 1, durationMs: 1234 };
      wakingCycle.runCycle.mockResolvedValue(cycleResult);
      controller = new AwarenessController(wakingCycle);

      const result = await controller.triggerCycle();

      expect(wakingCycle.runCycle).toHaveBeenCalledTimes(1);
      expect(result).toEqual(cycleResult);
    });

    it('should return error when waking cycle service is not available', async () => {
      controller = new AwarenessController(undefined);

      const result = await controller.triggerCycle();

      expect(result).toEqual({
        error: 'Waking Cycle not available. Set AWARENESS_ENABLED=true and redeploy.',
        enabled: AwarenessConfig.enabled,
      });
    });
  });
});
