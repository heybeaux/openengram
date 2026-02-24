import { Test, TestingModule } from '@nestjs/testing';
import { QueueService, JobStatus } from './queue.service';

describe('QueueService', () => {
  let service: QueueService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [QueueService],
    }).compile();

    service = module.get<QueueService>(QueueService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should enqueue a job and return a jobId', () => {
    const jobId = service.enqueue('test', ['a', 'b'], async () => {});
    expect(jobId).toBeDefined();
    expect(typeof jobId).toBe('string');
  });

  it('should return null for unknown jobId', () => {
    expect(service.getStatus('nonexistent')).toBeNull();
  });

  it('should track progress through items', async () => {
    const items = [1, 2, 3];
    let resolveAll: () => void;
    const allDone = new Promise<void>((r) => (resolveAll = r));

    const jobId = service.enqueue('test', items, async (_item, index) => {
      if (index === items.length - 1) resolveAll();
    });

    await allDone;
    // Allow microtask for job completion
    await new Promise((r) => setTimeout(r, 10));

    const status = service.getStatus(jobId)!;
    expect(status.progress).toBe(3);
    expect(status.total).toBe(3);
    expect(status.status).toBe('completed');
    expect(status.completedAt).toBeInstanceOf(Date);
  });

  it('should handle per-item errors without stopping', async () => {
    const items = ['ok', 'fail', 'ok'];
    const jobId = service.enqueue('test', items, async (item) => {
      if (item === 'fail') throw new Error('boom');
    });

    // Wait for completion
    await new Promise((r) => setTimeout(r, 50));

    const status = service.getStatus(jobId)!;
    expect(status.status).toBe('completed');
    expect(status.progress).toBe(3);
    expect(status.errors).toHaveLength(1);
    expect(status.errors[0].index).toBe(1);
    expect(status.errors[0].message).toBe('boom');
    expect(status.error).toBe('1/3 items failed');
  });

  it('should mark as failed when all items fail', async () => {
    const jobId = service.enqueue('test', ['a', 'b'], async () => {
      throw new Error('nope');
    });

    await new Promise((r) => setTimeout(r, 50));

    const status = service.getStatus(jobId)!;
    expect(status.status).toBe('failed');
    expect(status.errors).toHaveLength(2);
  });

  it('should start with pending status', () => {
    // Use a slow processor so we can catch pending/processing
    const jobId = service.enqueue('test', ['a'], async () => {
      await new Promise((r) => setTimeout(r, 500));
    });

    const status = service.getStatus(jobId)!;
    expect(['pending', 'processing']).toContain(status.status);
  });
});
