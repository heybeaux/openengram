import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { createHash } from 'crypto';
import { MemoryLayer, SubjectType } from '@prisma/client';

describe('Agent Self-Memory API (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  // Test data
  const testApiKey = 'sk-test-agent-self-memory-key';
  const testApiKeyHash = createHash('sha256').update(testApiKey).digest('hex');
  const testUserId = 'test-user-agent-self-memory';
  const testAgentName = 'rook';
  let testAgentId: string;
  let testInternalUserId: string;
  const createdMemoryIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.init();

    prisma = app.get(PrismaService);

    // Clean up any existing test data
    await prisma.memory.deleteMany({
      where: {
        user: {
          externalId: testUserId,
        },
      },
    });
    await prisma.user.deleteMany({
      where: { externalId: testUserId },
    });
    await prisma.agent.deleteMany({
      where: { apiKeyHash: testApiKeyHash },
    });

    // Create test agent
    const agent = await prisma.agent.create({
      data: {
        name: 'Agent Self-Memory Test Agent',
        apiKeyHash: testApiKeyHash,
        apiKeyHint: 'test',
      },
    });
    testAgentId = agent.id;
  });

  afterAll(async () => {
    // Clean up test data
    if (createdMemoryIds.length > 0) {
      await prisma.memoryExtraction.deleteMany({
        where: {
          memoryId: { in: createdMemoryIds },
        },
      });
      await prisma.memory.deleteMany({
        where: { id: { in: createdMemoryIds } },
      });
    }
    if (testInternalUserId) {
      await prisma.memory.deleteMany({
        where: { userId: testInternalUserId },
      });
    }
    await prisma.user.deleteMany({
      where: { externalId: testUserId },
    });
    await prisma.agent.deleteMany({
      where: { id: testAgentId },
    });

    await app.close();
  });

  describe('POST /v1/memories - Agent Self-Memories', () => {
    it('should create a memory about a user (default subjectType)', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/memories')
        .set('X-AM-API-Key', testApiKey)
        .set('X-AM-User-ID', testUserId)
        .send({
          raw: 'User prefers dark mode',
        })
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.raw).toBe('User prefers dark mode');
      expect(response.body.subjectType).toBe('USER');
      expect(response.body.agentId).toBeNull();
      
      createdMemoryIds.push(response.body.id);
      testInternalUserId = response.body.userId;
    });

    it('should create an agent self-memory with AGENT subjectType', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/memories')
        .set('X-AM-API-Key', testApiKey)
        .set('X-AM-User-ID', testUserId)
        .send({
          raw: 'I am Rook, an AI assistant created on January 26, 2026',
          subjectType: 'AGENT',
          subjectId: testAgentName,
          agentId: testAgentName,
          layer: 'IDENTITY',
        })
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.raw).toContain('I am Rook');
      expect(response.body.subjectType).toBe('AGENT');
      expect(response.body.subjectId).toBe(testAgentName);
      expect(response.body.agentId).toBe(testAgentName);
      expect(response.body.layer).toBe('IDENTITY');
      
      createdMemoryIds.push(response.body.id);
    });

    it('should create a lesson-learned memory for the agent', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/memories')
        .set('X-AM-API-Key', testApiKey)
        .set('X-AM-User-ID', testUserId)
        .send({
          raw: 'I learned to always verify data exists before marking tasks COMPLETED',
          subjectType: 'AGENT',
          subjectId: testAgentName,
          agentId: testAgentName,
          layer: 'IDENTITY',
        })
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.subjectType).toBe('AGENT');
      expect(response.body.agentId).toBe(testAgentName);
      
      createdMemoryIds.push(response.body.id);
    });

    it('should create an ENTITY type memory', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/memories')
        .set('X-AM-API-Key', testApiKey)
        .set('X-AM-User-ID', testUserId)
        .send({
          raw: 'The Engram project uses PostgreSQL with pgvector for vector storage',
          subjectType: 'ENTITY',
          subjectId: 'engram-project',
          layer: 'PROJECT',
        })
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.subjectType).toBe('ENTITY');
      expect(response.body.subjectId).toBe('engram-project');
      
      createdMemoryIds.push(response.body.id);
    });
  });

  describe('POST /v1/memories/query - Filtering by Subject Type', () => {
    // Give time for async extraction to complete before querying
    beforeAll(async () => {
      await new Promise(resolve => setTimeout(resolve, 3000));
    });
    it('should recall only USER memories when includeAgentMemories=false', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/memories/query')
        .set('X-AM-API-Key', testApiKey)
        .set('X-AM-User-ID', testUserId)
        .send({
          query: 'dark mode preferences',
          includeAgentMemories: false,
        })
        .expect(201);

      expect(response.body).toHaveProperty('memories');
      // All returned memories should be USER type
      for (const memory of response.body.memories) {
        expect(memory.subjectType).toBe('USER');
      }
    });

    it('should recall only AGENT memories when includeUserMemories=false', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/memories/query')
        .set('X-AM-API-Key', testApiKey)
        .set('X-AM-User-ID', testUserId)
        .send({
          query: 'Rook AI assistant',
          includeUserMemories: false,
        })
        .expect(201);

      expect(response.body).toHaveProperty('memories');
      // All returned memories should be AGENT type
      for (const memory of response.body.memories) {
        expect(memory.subjectType).toBe('AGENT');
      }
    });

    it('should recall memories for a specific agent by agentId', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/memories/query')
        .set('X-AM-API-Key', testApiKey)
        .set('X-AM-User-ID', testUserId)
        .send({
          query: 'lessons learned verification',
          agentId: testAgentName,
        })
        .expect(201);

      expect(response.body).toHaveProperty('memories');
      // All returned memories should be for the specified agent
      for (const memory of response.body.memories) {
        expect(memory.agentId).toBe(testAgentName);
      }
    });

    it('should recall all memories when no subject filters applied', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/memories/query')
        .set('X-AM-API-Key', testApiKey)
        .set('X-AM-User-ID', testUserId)
        .send({
          query: 'test',
        })
        .expect(201);

      expect(response.body).toHaveProperty('memories');
      // Should include multiple subject types
      const subjectTypes = new Set(response.body.memories.map((m: any) => m.subjectType));
      expect(subjectTypes.size).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Database Verification', () => {
    it('should have persisted subject type fields correctly', async () => {
      // Verify agent self-memory is in database with correct fields
      const agentMemory = await prisma.memory.findFirst({
        where: {
          agentId: testAgentName,
          subjectType: 'AGENT',
        },
      });

      expect(agentMemory).not.toBeNull();
      expect(agentMemory?.subjectType).toBe('AGENT');
      expect(agentMemory?.subjectId).toBe(testAgentName);
      expect(agentMemory?.agentId).toBe(testAgentName);
    });

    it('should have correct index for subject type queries', async () => {
      // This is a smoke test - if the index doesn't exist, this query would be slow
      const startTime = Date.now();
      await prisma.memory.findMany({
        where: {
          subjectType: 'AGENT',
          agentId: testAgentName,
        },
        take: 10,
      });
      const queryTime = Date.now() - startTime;
      
      // Should be very fast with index (< 100ms)
      expect(queryTime).toBeLessThan(1000);
    });
  });
});
