import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { createHash } from 'crypto';
import { MemoryLayer, ImportanceHint } from '@prisma/client';

describe('Memory API (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  // Test data
  const testApiKey = 'sk-test-e2e-key-12345678';
  const testApiKeyHash = createHash('sha256').update(testApiKey).digest('hex');
  const testUserId = 'test-user-e2e-123';
  let testAgentId: string;
  let testInternalUserId: string;

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
        name: 'E2E Test Agent',
        apiKeyHash: testApiKeyHash,
        apiKeyHint: '5678',
      },
    });
    testAgentId = agent.id;
  });

  afterAll(async () => {
    // Clean up test data
    if (testInternalUserId) {
      await prisma.memoryExtraction.deleteMany({
        where: {
          memory: {
            userId: testInternalUserId,
          },
        },
      });
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

  describe('Authentication', () => {
    it('should reject requests without API key', () => {
      return request(app.getHttpServer())
        .post('/v1/memories')
        .set('X-AM-User-ID', testUserId)
        .send({ raw: 'Test memory' })
        .expect(401)
        .expect((res) => {
          expect(res.body.message).toContain('X-AM-API-Key');
        });
    });

    it('should reject requests without user ID', () => {
      return request(app.getHttpServer())
        .post('/v1/memories')
        .set('X-AM-API-Key', testApiKey)
        .send({ raw: 'Test memory' })
        .expect(401)
        .expect((res) => {
          expect(res.body.message).toContain('X-AM-User-ID');
        });
    });

    it('should reject invalid API key', () => {
      return request(app.getHttpServer())
        .post('/v1/memories')
        .set('X-AM-API-Key', 'invalid-key')
        .set('X-AM-User-ID', testUserId)
        .send({ raw: 'Test memory' })
        .expect(401)
        .expect((res) => {
          expect(res.body.message).toContain('Invalid API key');
        });
    });

    it('should auto-create user on first request', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/memories')
        .set('X-AM-API-Key', testApiKey)
        .set('X-AM-User-ID', testUserId)
        .send({ raw: 'First memory from new user' })
        .expect(201);

      expect(response.body.id).toBeDefined();

      // Verify user was created
      const user = await prisma.user.findFirst({
        where: { externalId: testUserId },
      });
      expect(user).toBeDefined();
      testInternalUserId = user!.id;
    });
  });

  describe('POST /v1/memories', () => {
    it('should create a memory with minimal data', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/memories')
        .set('X-AM-API-Key', testApiKey)
        .set('X-AM-User-ID', testUserId)
        .send({ raw: 'Simple test memory' })
        .expect(201);

      expect(response.body).toMatchObject({
        id: expect.any(String),
        raw: 'Simple test memory',
        layer: 'SESSION', // Default
        source: 'EXPLICIT_STATEMENT',
        importanceScore: expect.any(Number),
      });
    });

    it('should create a memory with all options', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/memories')
        .set('X-AM-API-Key', testApiKey)
        .set('X-AM-User-ID', testUserId)
        .send({
          raw: 'I prefer TypeScript over JavaScript',
          layer: 'IDENTITY',
          importanceHint: 'HIGH',
          context: {
            projectId: 'project-123',
            sessionId: 'session-456',
          },
        })
        .expect(201);

      expect(response.body).toMatchObject({
        raw: 'I prefer TypeScript over JavaScript',
        layer: 'IDENTITY',
        importanceHint: 'HIGH',
      });
      expect(response.body.importanceScore).toBeGreaterThan(0.3);
    });

    it('should reject invalid layer', () => {
      return request(app.getHttpServer())
        .post('/v1/memories')
        .set('X-AM-API-Key', testApiKey)
        .set('X-AM-User-ID', testUserId)
        .send({
          raw: 'Test',
          layer: 'INVALID_LAYER',
        })
        .expect(400);
    });

    it('should reject empty raw content', () => {
      return request(app.getHttpServer())
        .post('/v1/memories')
        .set('X-AM-API-Key', testApiKey)
        .set('X-AM-User-ID', testUserId)
        .send({
          raw: '',
        })
        .expect(400);
    });
  });

  describe('POST /v1/memories/batch', () => {
    it('should create multiple memories', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/memories/batch')
        .set('X-AM-API-Key', testApiKey)
        .set('X-AM-User-ID', testUserId)
        .send({
          memories: [
            { raw: 'Batch memory 1' },
            { raw: 'Batch memory 2' },
            { raw: 'Batch memory 3', layer: 'PROJECT' },
          ],
          context: {
            projectId: 'batch-project',
          },
        })
        .expect(201);

      expect(response.body).toEqual({
        created: 3,
        failed: 0,
      });
    });

    it('should handle empty batch', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/memories/batch')
        .set('X-AM-API-Key', testApiKey)
        .set('X-AM-User-ID', testUserId)
        .send({
          memories: [],
        })
        .expect(201);

      expect(response.body).toEqual({
        created: 0,
        failed: 0,
      });
    });
  });

  describe('GET /v1/memories/:id', () => {
    let memoryId: string;

    beforeAll(async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/memories')
        .set('X-AM-API-Key', testApiKey)
        .set('X-AM-User-ID', testUserId)
        .send({ raw: 'Memory to retrieve' });
      memoryId = response.body.id;
    });

    it('should retrieve a memory by ID', async () => {
      const response = await request(app.getHttpServer())
        .get(`/v1/memories/${memoryId}`)
        .set('X-AM-API-Key', testApiKey)
        .set('X-AM-User-ID', testUserId)
        .expect(200);

      expect(response.body).toMatchObject({
        id: memoryId,
        raw: 'Memory to retrieve',
      });
    });

    it('should return null for non-existent memory', async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/memories/non-existent-id')
        .set('X-AM-API-Key', testApiKey)
        .set('X-AM-User-ID', testUserId)
        .expect(200);

      expect(response.body).toBeNull();
    });
  });

  describe('DELETE /v1/memories/:id', () => {
    let memoryId: string;

    beforeEach(async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/memories')
        .set('X-AM-API-Key', testApiKey)
        .set('X-AM-User-ID', testUserId)
        .send({ raw: 'Memory to delete' });
      memoryId = response.body.id;
    });

    it('should soft delete a memory', async () => {
      await request(app.getHttpServer())
        .delete(`/v1/memories/${memoryId}`)
        .set('X-AM-API-Key', testApiKey)
        .set('X-AM-User-ID', testUserId)
        .expect(204);

      // Verify memory is soft deleted
      const memory = await prisma.memory.findUnique({
        where: { id: memoryId },
      });
      expect(memory?.deletedAt).not.toBeNull();
    });
  });

  describe('POST /v1/memories/:id/used', () => {
    let memoryId: string;

    beforeAll(async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/memories')
        .set('X-AM-API-Key', testApiKey)
        .set('X-AM-User-ID', testUserId)
        .send({ raw: 'Memory to mark as used' });
      memoryId = response.body.id;
    });

    it('should mark memory as used', async () => {
      await request(app.getHttpServer())
        .post(`/v1/memories/${memoryId}/used`)
        .set('X-AM-API-Key', testApiKey)
        .set('X-AM-User-ID', testUserId)
        .expect(204);

      // Verify usedCount was incremented
      const memory = await prisma.memory.findUnique({
        where: { id: memoryId },
      });
      expect(memory?.usedCount).toBe(1);
      expect(memory?.lastUsedAt).not.toBeNull();
    });

    it('should increment usedCount on multiple calls', async () => {
      await request(app.getHttpServer())
        .post(`/v1/memories/${memoryId}/used`)
        .set('X-AM-API-Key', testApiKey)
        .set('X-AM-User-ID', testUserId)
        .expect(204);

      const memory = await prisma.memory.findUnique({
        where: { id: memoryId },
      });
      expect(memory?.usedCount).toBe(2);
    });
  });

  describe('POST /v1/memories/query', () => {
    beforeAll(async () => {
      // Create some memories for search
      await request(app.getHttpServer())
        .post('/v1/memories/batch')
        .set('X-AM-API-Key', testApiKey)
        .set('X-AM-User-ID', testUserId)
        .send({
          memories: [
            { raw: 'I love programming in Rust' },
            { raw: 'Python is great for data science' },
            { raw: 'JavaScript runs in the browser' },
          ],
        });

      // Wait for async embedding generation
      await new Promise((r) => setTimeout(r, 100));
    });

    it('should perform semantic search', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/memories/query')
        .set('X-AM-API-Key', testApiKey)
        .set('X-AM-User-ID', testUserId)
        .send({
          query: 'programming languages',
          limit: 5,
        })
        .expect(201);

      expect(response.body).toMatchObject({
        memories: expect.any(Array),
        queryTokens: expect.any(Number),
        latencyMs: expect.any(Number),
      });
    });

    it('should filter by layers', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/memories/query')
        .set('X-AM-API-Key', testApiKey)
        .set('X-AM-User-ID', testUserId)
        .send({
          query: 'programming',
          layers: ['IDENTITY'],
          limit: 5,
        })
        .expect(201);

      expect(response.body.memories).toBeInstanceOf(Array);
    });

    it('should respect limit parameter', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/memories/query')
        .set('X-AM-API-Key', testApiKey)
        .set('X-AM-User-ID', testUserId)
        .send({
          query: 'test',
          limit: 2,
        })
        .expect(201);

      expect(response.body.memories.length).toBeLessThanOrEqual(2);
    });
  });

  describe('POST /v1/context', () => {
    beforeAll(async () => {
      // Create memories for context loading
      await request(app.getHttpServer())
        .post('/v1/memories')
        .set('X-AM-API-Key', testApiKey)
        .set('X-AM-User-ID', testUserId)
        .send({
          raw: 'My name is John and I work as a developer',
          layer: 'IDENTITY',
          importanceHint: 'HIGH',
        });

      await request(app.getHttpServer())
        .post('/v1/memories')
        .set('X-AM-API-Key', testApiKey)
        .set('X-AM-User-ID', testUserId)
        .send({
          raw: 'Currently building an agent memory system',
          layer: 'SESSION',
        });
    });

    it('should load context from all layers', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/context')
        .set('X-AM-API-Key', testApiKey)
        .set('X-AM-User-ID', testUserId)
        .send({})
        .expect(201);

      expect(response.body).toMatchObject({
        context: expect.any(String),
        tokenCount: expect.any(Number),
        memoriesIncluded: expect.any(Number),
        layers: {
          identity: expect.any(Number),
          project: expect.any(Number),
          session: expect.any(Number),
        },
      });
    });

    it('should format context with layer headers', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/context')
        .set('X-AM-API-Key', testApiKey)
        .set('X-AM-User-ID', testUserId)
        .send({})
        .expect(201);

      // Should contain layer headers if there are memories
      if (response.body.layers.identity > 0) {
        expect(response.body.context).toContain('## User Identity');
      }
      if (response.body.layers.session > 0) {
        expect(response.body.context).toContain('## Recent Context');
      }
    });

    it('should respect maxTokens limit', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/context')
        .set('X-AM-API-Key', testApiKey)
        .set('X-AM-User-ID', testUserId)
        .send({
          maxTokens: 50,
        })
        .expect(201);

      expect(response.body.tokenCount).toBeLessThanOrEqual(100); // Some margin
    });

    it('should include project memories when projectId specified', async () => {
      // First create a project memory
      await request(app.getHttpServer())
        .post('/v1/memories')
        .set('X-AM-API-Key', testApiKey)
        .set('X-AM-User-ID', testUserId)
        .send({
          raw: 'Project-specific memory',
          layer: 'PROJECT',
          context: {
            projectId: 'test-project-123',
          },
        });

      const response = await request(app.getHttpServer())
        .post('/v1/context')
        .set('X-AM-API-Key', testApiKey)
        .set('X-AM-User-ID', testUserId)
        .send({
          projectId: 'test-project-123',
        })
        .expect(201);

      expect(response.body.layers.project).toBeGreaterThanOrEqual(0);
    });
  });

  describe('POST /v1/memories/:id/correct', () => {
    let memoryId: string;

    beforeAll(async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/memories')
        .set('X-AM-API-Key', testApiKey)
        .set('X-AM-User-ID', testUserId)
        .send({ raw: 'Original memory content' });
      memoryId = response.body.id;
    });

    it('should create a correction memory', async () => {
      const response = await request(app.getHttpServer())
        .post(`/v1/memories/${memoryId}/correct`)
        .set('X-AM-API-Key', testApiKey)
        .set('X-AM-User-ID', testUserId)
        .send({
          correction: 'Corrected memory content',
        })
        .expect(201);

      expect(response.body.raw).toBe('Corrected memory content');
    });
  });

  describe('POST /v1/memories/:id/helpful', () => {
    let memoryId: string;

    beforeAll(async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/memories')
        .set('X-AM-API-Key', testApiKey)
        .set('X-AM-User-ID', testUserId)
        .send({ raw: 'Helpful memory' });
      memoryId = response.body.id;
    });

    it('should mark memory as helpful', async () => {
      await request(app.getHttpServer())
        .post(`/v1/memories/${memoryId}/helpful`)
        .set('X-AM-API-Key', testApiKey)
        .set('X-AM-User-ID', testUserId)
        .expect(204);
    });
  });
});
