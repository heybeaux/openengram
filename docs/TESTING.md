# Testing Guide

## Overview
- **Framework**: Jest 30 with ts-jest
- **Tests**: 1,100+ across 57 suites
- **Convention**: Co-located — `foo.service.spec.ts` next to `foo.service.ts`
- **Config**: In `package.json` under `"jest"` key
- **Setup**: `src/test-setup.ts` auto-closes NestJS TestingModules

## Running Tests
```bash
npm test                    # All tests
npm test -- --watch         # Watch mode
npm test -- path/to/file    # Single file
npm run test:cov            # With coverage
```

## Test Structure
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { MyService } from './my.service';
import { PrismaService } from '../prisma/prisma.service';

describe('MyService', () => {
  let service: MyService;
  let mockPrisma: any;

  beforeEach(async () => {
    mockPrisma = {
      memory: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      $queryRaw: jest.fn(),
      $transaction: jest.fn((fn) => fn(mockPrisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MyService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('test') } },
      ],
    }).compile();

    service = module.get<MyService>(MyService);
  });

  it('should do the thing', async () => {
    mockPrisma.memory.findMany.mockResolvedValue([{ id: '1', raw: 'test' }]);
    const result = await service.findAll('user-1');
    expect(result).toHaveLength(1);
    expect(mockPrisma.memory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1' } })
    );
  });
});
```

## Common Mocks

### PrismaService
```typescript
const mockPrisma = {
  memory: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  memoryExtraction: { create: jest.fn() },
  $queryRaw: jest.fn(),
  $queryRawUnsafe: jest.fn(),
  $executeRaw: jest.fn(),
  $executeRawUnsafe: jest.fn(),
  $transaction: jest.fn((fn) => fn(mockPrisma)),
};
```

### ConfigService
```typescript
{ provide: ConfigService, useValue: { get: jest.fn((key: string) => {
  const config = { DATABASE_URL: 'test', OPENAI_API_KEY: 'sk-test' };
  return config[key];
}) } }
```

### LlmService
```typescript
{ provide: LlmService, useValue: { generateCompletion: jest.fn(), generateEmbedding: jest.fn() } }
```

## Auto-Cleanup
`src/test-setup.ts` monkey-patches `Test.createTestingModule` to track all compiled modules and close them in `afterEach`. You don't need manual cleanup.

## Tips
- Always mock external services (LLM, Prisma) — tests must run without a database
- Set `x-am-user-id` in request mocks for controller tests
- Use `jest.fn().mockResolvedValue()` for async mocks
- `$transaction` mock should invoke the callback with the mock prisma instance
