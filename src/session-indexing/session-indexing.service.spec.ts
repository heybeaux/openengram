import { Test, TestingModule } from '@nestjs/testing';
import { SessionIndexingService } from './session-indexing.service';
import { PrismaService } from '../prisma/prisma.service';
import { MemoryService } from '../memory/memory.service';
import { EmbeddingService } from '../embedding/embedding.service';

describe('SessionIndexingService', () => {
  let service: SessionIndexingService;
  let memoryService: jest.Mocked<MemoryService>;
  let prisma: any;

  beforeEach(async () => {
    const mockMemoryService = {
      remember: jest.fn().mockResolvedValue({ id: 'mem-1', raw: 'test' }),
    };

    const mockPrisma = {
      session: {
        findFirst: jest.fn().mockResolvedValue({ id: 'session-internal-1' }),
      },
      memory: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };

    const mockEmbedding = {
      embed: jest.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionIndexingService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: MemoryService, useValue: mockMemoryService },
        { provide: EmbeddingService, useValue: mockEmbedding },
      ],
    }).compile();

    service = module.get(SessionIndexingService);
    memoryService = module.get(MemoryService);
    prisma = module.get(PrismaService);
  });

  describe('indexSession (HEY-326)', () => {
    it('should chunk and store a transcript', async () => {
      const result = await service.indexSession('user-1', {
        sessionId: 'sess-1',
        transcript:
          'Hello, how are you? I am fine. Let us talk about the project. The project is going well.',
      });

      expect(result.sessionId).toBe('sess-1');
      expect(result.chunksCreated).toBeGreaterThan(0);
      expect(result.memoryIds).toHaveLength(result.chunksCreated);
      expect(memoryService.remember).toHaveBeenCalled();

      // Verify memories are stored with SESSION layer
      const callArgs = memoryService.remember.mock.calls[0];
      expect(callArgs[1].layer).toBe('SESSION');
      expect(callArgs[1].context?.sessionId).toBe('sess-1');
    });

    it('should create multiple chunks for long transcripts', async () => {
      const longTranscript = Array(100)
        .fill('This is a sentence that makes up part of a conversation. ')
        .join('');

      const result = await service.indexSession('user-1', {
        sessionId: 'sess-2',
        transcript: longTranscript,
        chunkSize: 500,
        chunkOverlap: 50,
      });

      expect(result.chunksCreated).toBeGreaterThan(1);
    });

    it('should handle empty transcript', async () => {
      const result = await service.indexSession('user-1', {
        sessionId: 'sess-3',
        transcript: '',
      });

      expect(result.chunksCreated).toBe(0);
      expect(result.memoryIds).toHaveLength(0);
    });

    it('should continue on individual chunk failures', async () => {
      memoryService.remember
        .mockResolvedValueOnce({ id: 'mem-1' } as any)
        .mockRejectedValueOnce(new Error('embedding failed'))
        .mockResolvedValueOnce({ id: 'mem-3' } as any);

      const transcript = Array(50)
        .fill('Sentence for testing chunk failures. ')
        .join('');

      const result = await service.indexSession('user-1', {
        sessionId: 'sess-4',
        transcript,
        chunkSize: 200,
      });

      // Should have stored some chunks even with failures
      expect(result.chunksCreated).toBeGreaterThan(0);
    });
  });

  describe('getSessionMemories (HEY-326)', () => {
    it('should return memories for a session', async () => {
      prisma.memory.findMany.mockResolvedValue([
        { id: 'mem-1', raw: 'chunk 1', sessionId: 'session-internal-1' },
      ]);
      prisma.memory.count.mockResolvedValue(1);

      const result = await service.getSessionMemories('user-1', 'sess-1');

      expect(result.sessionId).toBe('sess-1');
      expect(result.total).toBe(1);
      expect(result.memories).toHaveLength(1);
    });

    it('should return empty for unknown session', async () => {
      prisma.session.findFirst.mockResolvedValue(null);

      const result = await service.getSessionMemories('user-1', 'unknown');

      expect(result.memories).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });

  describe('flushMemories (HEY-327)', () => {
    it('should store all flush memories with pre-compaction prefix', async () => {
      const result = await service.flushMemories('user-1', {
        memories: [
          { content: 'User prefers dark mode' },
          { content: 'Project deadline is March 1st', layer: 'PROJECT' },
        ],
        reason: 'pre_compaction',
      });

      expect(result.flushed).toBe(2);
      expect(result.failed).toBe(0);
      expect(result.memoryIds).toHaveLength(2);
      expect(result.reason).toBe('pre_compaction');

      // Check that content is prefixed
      const firstCall = memoryService.remember.mock.calls[0];
      expect(firstCall[1].raw).toContain('[pre-compaction]');
      expect(firstCall[1].raw).toContain('User prefers dark mode');
    });

    it('should use HIGH importance by default for flush', async () => {
      await service.flushMemories('user-1', {
        memories: [{ content: 'Important context' }],
      });

      const callArgs = memoryService.remember.mock.calls[0];
      expect(callArgs[1].importanceHint).toBe('HIGH');
    });

    it('should respect explicit importance hints', async () => {
      await service.flushMemories('user-1', {
        memories: [{ content: 'Critical safety info', importance: 'CRITICAL' }],
      });

      const callArgs = memoryService.remember.mock.calls[0];
      expect(callArgs[1].importanceHint).toBe('CRITICAL');
    });

    it('should handle partial failures gracefully', async () => {
      memoryService.remember
        .mockResolvedValueOnce({ id: 'mem-1' } as any)
        .mockRejectedValueOnce(new Error('db error'))
        .mockResolvedValueOnce({ id: 'mem-3' } as any);

      const result = await service.flushMemories('user-1', {
        memories: [
          { content: 'memory 1' },
          { content: 'memory 2' },
          { content: 'memory 3' },
        ],
      });

      expect(result.flushed).toBe(2);
      expect(result.failed).toBe(1);
      expect(result.memoryIds).toHaveLength(2);
    });

    it('should propagate sessionId and agentId from top-level dto', async () => {
      await service.flushMemories('user-1', {
        memories: [{ content: 'test' }],
        sessionId: 'global-session',
        agentId: 'agent-1',
      });

      const callArgs = memoryService.remember.mock.calls[0];
      expect(callArgs[1].context?.sessionId).toBe('global-session');
      expect(callArgs[1].agentId).toBe('agent-1');
    });

    it('should allow per-memory sessionId override', async () => {
      await service.flushMemories('user-1', {
        memories: [{ content: 'test', sessionId: 'specific-session' }],
        sessionId: 'global-session',
      });

      const callArgs = memoryService.remember.mock.calls[0];
      expect(callArgs[1].context?.sessionId).toBe('specific-session');
    });
  });
});
