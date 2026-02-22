import { HttpException, HttpStatus } from '@nestjs/common';
import { DeduplicationController } from './deduplication.controller';

describe('DeduplicationController', () => {
  let controller: DeduplicationController;
  let dedupService: any;
  let reviewService: any;
  let lineageService: any;

  beforeEach(() => {
    dedupService = {
      runBatchDedup: jest.fn().mockResolvedValue({
        scanId: 'scan-1',
        status: 'completed',
        memoriesProcessed: 100,
        clustersFound: 5,
        autoMerged: 3,
        queuedForReview: 2,
        durationMs: 1500,
      }),
      getJobStatus: jest.fn(),
      manualMerge: jest.fn().mockResolvedValue({ mergeEventId: 'merge-1', survivorId: 'mem-1' }),
      rollback: jest.fn().mockResolvedValue({ success: true }),
      findSimilar: jest.fn().mockResolvedValue([]),
      getConfig: jest.fn().mockResolvedValue({ autoMergeThreshold: 0.9, reviewSuggestThreshold: 0.7, defaultStrategy: 'APPEND', protectedTypes: [], protectedKeywords: [] }),
      updateConfig: jest.fn().mockResolvedValue({ autoMergeThreshold: 0.9 }),
      getStats: jest.fn().mockResolvedValue({ totalMemories: 100, potentialDuplicates: 5, clustersIdentified: 3, autoMergedToday: 2, pendingReview: 1 }),
      isEnabled: jest.fn().mockReturnValue(true),
    };
    reviewService = {
      getCandidates: jest.fn().mockResolvedValue({ candidates: [], total: 0 }),
      getCandidate: jest.fn(),
      approve: jest.fn().mockResolvedValue({ success: true }),
      reject: jest.fn().mockResolvedValue({ success: true }),
      skip: jest.fn().mockResolvedValue({ success: true, nextReviewAt: new Date() }),
    };
    lineageService = {
      getMergeHistory: jest.fn().mockResolvedValue({ events: [], total: 0 }),
      getMergeEvent: jest.fn(),
      getMemoryLineage: jest.fn().mockResolvedValue({ mergedFrom: [], mergedInto: null, mergeEvents: [] }),
    };

    controller = new DeduplicationController(dedupService, reviewService, lineageService);
  });

  // === Scan ===
  describe('scan', () => {
    it('should trigger batch dedup scan', async () => {
      const result = await controller.scan('user-1', { dryRun: false });
      expect(result.scanId).toBe('scan-1');
      expect(dedupService.runBatchDedup).toHaveBeenCalledWith('user-1', expect.objectContaining({ dryRun: false }));
    });

    it('should use dto.userId if provided', async () => {
      await controller.scan('user-1', { userId: 'user-2', dryRun: true });
      expect(dedupService.runBatchDedup).toHaveBeenCalledWith('user-2', expect.anything());
    });

    it('should throw BAD_REQUEST on error', async () => {
      dedupService.runBatchDedup.mockRejectedValue(new Error('Job already running'));
      await expect(controller.scan('user-1', {})).rejects.toThrow(HttpException);
    });
  });

  describe('getScanStatus', () => {
    it('should return job status', () => {
      const now = new Date();
      dedupService.getJobStatus.mockReturnValue({
        id: 'scan-1', status: 'completed', memoriesProcessed: 50,
        clustersFound: 3, autoMerged: 2, queuedForReview: 1,
        startedAt: now, completedAt: new Date(now.getTime() + 1000),
      });
      const result = controller.getScanStatus('scan-1');
      expect(result.scanId).toBe('scan-1');
      expect(result.durationMs).toBe(1000);
    });

    it('should throw NOT_FOUND for missing scan', () => {
      dedupService.getJobStatus.mockReturnValue(null);
      expect(() => controller.getScanStatus('missing')).toThrow(HttpException);
    });
  });

  // === Review Queue ===
  describe('getCandidates', () => {
    it('should return candidates list', async () => {
      const result = await controller.getCandidates('user-1', {});
      expect(reviewService.getCandidates).toHaveBeenCalled();
      expect(result).toEqual({ candidates: [], total: 0 });
    });
  });

  describe('getCandidate', () => {
    it('should return candidate by ID', async () => {
      reviewService.getCandidate.mockResolvedValue({ id: 'cand-1' });
      const result = await controller.getCandidate('cand-1');
      expect(result.id).toBe('cand-1');
    });

    it('should throw NOT_FOUND for missing candidate', async () => {
      reviewService.getCandidate.mockResolvedValue(null);
      await expect(controller.getCandidate('missing')).rejects.toThrow(HttpException);
    });
  });

  describe('approve', () => {
    it('should approve a candidate', async () => {
      const result = await controller.approve('cand-1', {}, 'approver-1');
      expect(reviewService.approve).toHaveBeenCalledWith('cand-1', {}, 'approver-1');
      expect(result.success).toBe(true);
    });

    it('should throw NOT_FOUND when candidate not found', async () => {
      reviewService.approve.mockRejectedValue(new Error('Candidate not found'));
      await expect(controller.approve('missing', {})).rejects.toThrow(HttpException);
    });

    it('should throw BAD_REQUEST for other errors', async () => {
      reviewService.approve.mockRejectedValue(new Error('Invalid state'));
      try {
        await controller.approve('cand-1', {});
      } catch (e: any) {
        expect(e.getStatus()).toBe(HttpStatus.BAD_REQUEST);
      }
    });
  });

  describe('reject', () => {
    it('should reject a candidate', async () => {
      await controller.reject('cand-1', { reason: 'not duplicate' }, 'approver-1');
      expect(reviewService.reject).toHaveBeenCalledWith('cand-1', { reason: 'not duplicate' }, 'approver-1');
    });

    it('should throw NOT_FOUND when candidate not found', async () => {
      reviewService.reject.mockRejectedValue(new Error('not found'));
      await expect(controller.reject('missing', { reason: 'test' })).rejects.toThrow(HttpException);
    });
  });

  describe('skip', () => {
    it('should skip a candidate', async () => {
      const result = await controller.skip('cand-1', 14);
      expect(reviewService.skip).toHaveBeenCalledWith('cand-1', 14);
      expect(result.success).toBe(true);
    });

    it('should throw NOT_FOUND when candidate not found', async () => {
      reviewService.skip.mockRejectedValue(new Error('not found'));
      await expect(controller.skip('missing')).rejects.toThrow(HttpException);
    });
  });

  // === Merge ===
  describe('merge', () => {
    it('should perform manual merge', async () => {
      const result = await controller.merge('user-1', { memoryIds: ['a', 'b'], strategy: 'APPEND' as any }, 'approver-1');
      expect(dedupService.manualMerge).toHaveBeenCalledWith({ memoryIds: ['a', 'b'], strategy: 'APPEND' }, 'user-1', 'approver-1');
      expect(result.mergeEventId).toBe('merge-1');
    });

    it('should throw BAD_REQUEST on error', async () => {
      dedupService.manualMerge.mockRejectedValue(new Error('Cannot merge'));
      await expect(controller.merge('user-1', { memoryIds: [], strategy: 'APPEND' as any })).rejects.toThrow(HttpException);
    });
  });

  describe('rollback', () => {
    it('should rollback a merge', async () => {
      const result = await controller.rollback('merge-1');
      expect(result.success).toBe(true);
    });

    it('should throw NOT_FOUND for missing merge event', async () => {
      dedupService.rollback.mockRejectedValue(new Error('not found'));
      await expect(controller.rollback('missing')).rejects.toThrow(HttpException);
    });
  });

  // === History & Lineage ===
  describe('getHistory', () => {
    it('should return merge history', async () => {
      const result = await controller.getHistory('user-1', 10, 0);
      expect(lineageService.getMergeHistory).toHaveBeenCalled();
      expect(result.total).toBe(0);
    });
  });

  describe('getMergeEvent', () => {
    it('should return merge event', async () => {
      lineageService.getMergeEvent.mockResolvedValue({ id: 'merge-1' });
      const result = await controller.getMergeEvent('merge-1');
      expect(result.id).toBe('merge-1');
    });

    it('should throw NOT_FOUND for missing event', async () => {
      lineageService.getMergeEvent.mockResolvedValue(null);
      await expect(controller.getMergeEvent('missing')).rejects.toThrow(HttpException);
    });
  });

  describe('getLineage', () => {
    it('should return memory lineage', async () => {
      const result = await controller.getLineage('mem-1');
      expect(result.mergedFrom).toEqual([]);
      expect(result.mergedInto).toBeNull();
    });
  });

  // === Similar ===
  describe('findSimilar', () => {
    it('should find similar memories', async () => {
      const result = await controller.findSimilar('mem-1', 'user-1', 5, 0.8);
      expect(dedupService.findSimilar).toHaveBeenCalledWith('mem-1', 'user-1', { topK: 5, minSimilarity: 0.8 });
    });
  });

  // === Config ===
  describe('getConfig', () => {
    it('should return config', async () => {
      const result = await controller.getConfig('user-1');
      expect(result.autoMergeThreshold).toBe(0.9);
    });
  });

  describe('updateConfig', () => {
    it('should update config', async () => {
      await controller.updateConfig('user-1', { autoMergeThreshold: 0.8 });
      expect(dedupService.updateConfig).toHaveBeenCalledWith('user-1', { autoMergeThreshold: 0.8 });
    });
  });

  // === Stats ===
  describe('getStats', () => {
    it('should return stats', async () => {
      const result = await controller.getStats('user-1');
      expect(result.totalMemories).toBe(100);
    });
  });

  describe('isEnabled', () => {
    it('should return enabled status', () => {
      const result = controller.isEnabled();
      expect(result.enabled).toBe(true);
      expect(result.version).toBe('1.0.0');
    });
  });
});
