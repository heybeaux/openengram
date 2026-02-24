import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';

export type JobStatus = {
  id: string;
  type: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  total: number;
  createdAt: Date;
  completedAt: Date | null;
  error: string | null;
  errors: Array<{ index: number; message: string }>;
};

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);
  private readonly jobs = new Map<string, JobStatus>();

  enqueue(
    type: string,
    items: any[],
    processor: (item: any, index: number) => Promise<void>,
  ): string {
    const id = randomUUID();
    const job: JobStatus = {
      id,
      type,
      status: 'pending',
      progress: 0,
      total: items.length,
      createdAt: new Date(),
      completedAt: null,
      error: null,
      errors: [],
    };
    this.jobs.set(id, job);

    // Fire and forget — process in background
    this.processJob(job, items, processor).catch((err) => {
      this.logger.error(`Job ${id} unexpected error: ${err.message}`);
    });

    return id;
  }

  getStatus(jobId: string): JobStatus | null {
    return this.jobs.get(jobId) ?? null;
  }

  private async processJob(
    job: JobStatus,
    items: any[],
    processor: (item: any, index: number) => Promise<void>,
  ): Promise<void> {
    job.status = 'processing';

    for (let i = 0; i < items.length; i++) {
      try {
        await processor(items[i], i);
      } catch (err: any) {
        job.errors.push({ index: i, message: err.message ?? String(err) });
        this.logger.warn(
          `Job ${job.id} item ${i} failed: ${err.message}`,
        );
      }
      job.progress = i + 1;
    }

    job.status = job.errors.length === items.length && items.length > 0 ? 'failed' : 'completed';
    job.completedAt = new Date();

    if (job.errors.length > 0) {
      job.error = `${job.errors.length}/${job.total} items failed`;
    }
  }
}
