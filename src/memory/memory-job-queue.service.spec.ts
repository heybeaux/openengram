import { BadRequestException } from '@nestjs/common';
import {
  MemoryJobQueueService,
  MAX_BATCH_SIZE,
  MemoryJob,
} from './memory-job-queue.service';

describe('MemoryJobQueueService', () => {
  let service: MemoryJobQueueService;

  beforeEach(() => {
    service = new MemoryJobQueueService();
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  it('should create a batch and return a batch ID', () => {
    service.registerProcessor(async () => {});
    const batchId = service.createBatch('user-1', [
      { memoryId: 'm1', raw: 'hello' },
      { memoryId: 'm2', raw: 'world' },
    ]);
    expect(batchId).toBeDefined();
    expect(typeof batchId).toBe('string');
    const status = service.getBatchStatus(batchId);
    expect(status).not.toBeNull();
    expect(status!.total).toBe(2);
  });

  it('should reject batches exceeding MAX_BATCH_SIZE', () => {
    service.registerProcessor(async () => {});
    const memories = Array.from({ length: MAX_BATCH_SIZE + 1 }, (_, i) => ({
      memoryId: `m${i}`,
      raw: `memory ${i}`,
    }));
    expect(() => service.createBatch('user-1', memories)).toThrow(
      BadRequestException,
    );
  });

  it('should process all jobs to completion', async () => {
    const processed: string[] = [];
    service.registerProcessor(async (job: MemoryJob) => {
      processed.push(job.memoryId);
    });
    const batchId = service.createBatch('user-1', [
      { memoryId: 'm1', raw: 'a' },
      { memoryId: 'm2', raw: 'b' },
      { memoryId: 'm3', raw: 'c' },
    ]);

    // Wait for processing
    await new Promise((r) => setTimeout(r, 200));

    const status = service.getBatchStatus(batchId);
    expect(status!.status).toBe('completed');
    expect(status!.completed).toBe(3);
    expect(status!.failed).toBe(0);
    expect(processed).toEqual(expect.arrayContaining(['m1', 'm2', 'm3']));
  });

  it('should retry failed jobs and mark as failed after max attempts', async () => {
    let attempts = 0;
    service.registerProcessor(async () => {
      attempts++;
      throw new Error('processing error');
    });

    const batchId = service.createBatch('user-1', [
      { memoryId: 'm1', raw: 'fail' },
    ]);

    // Wait for retries (3 attempts with exponential backoff: 1s, 4s — but test should be fast enough with the first few)
    await new Promise((r) => setTimeout(r, 8000));

    const status = service.getBatchStatus(batchId);
    expect(status!.failed).toBe(1);
    expect(status!.status).toBe('failed');
    expect(status!.errors).toHaveLength(1);
    expect(status!.errors[0].error).toBe('processing error');
    expect(attempts).toBe(3); // maxAttempts = 3
  }, 15000);

  it('should respect concurrency limit', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;

    service.registerProcessor(async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 50));
      concurrent--;
    });

    service.createBatch(
      'user-1',
      Array.from({ length: 10 }, (_, i) => ({
        memoryId: `m${i}`,
        raw: `memory ${i}`,
      })),
    );

    await new Promise((r) => setTimeout(r, 1000));

    // Default concurrency is 3
    expect(maxConcurrent).toBeLessThanOrEqual(3);
    expect(maxConcurrent).toBeGreaterThan(1);
  });

  it('should return null for unknown batch ID', () => {
    expect(service.getBatchStatus('nonexistent')).toBeNull();
  });

  it('should report partial status when some jobs fail', async () => {
    let callCount = 0;
    service.registerProcessor(async (job: MemoryJob) => {
      callCount++;
      if (job.memoryId === 'm2') {
        throw new Error('selective failure');
      }
    });

    const batchId = service.createBatch('user-1', [
      { memoryId: 'm1', raw: 'ok' },
      { memoryId: 'm2', raw: 'fail' },
      { memoryId: 'm3', raw: 'ok' },
    ]);

    // Wait for processing including retries for m2
    await new Promise((r) => setTimeout(r, 8000));

    const status = service.getBatchStatus(batchId);
    expect(status!.status).toBe('partial');
    expect(status!.completed).toBe(2);
    expect(status!.failed).toBe(1);
  }, 15000);
});
