# Testing Guide

## Running Tests
```bash
npm test                          # All tests
npm test -- --testPathPattern=correction  # Single module
npm test -- --forceExit --ci      # CI mode
```

## Pattern: TestingModule with Manual Mocks

Every spec file follows this pattern:

```typescript
import { Test, TestingModule } from '@nestjs/testing';

// 1. Define mocks at top level
const mockPrisma = {
  memory: { findMany: jest.fn(), update: jest.fn() },
  $queryRaw: jest.fn(),
  $transaction: jest.fn((fn) => fn(mockPrisma)),
};

const mockConfig = {
  get: jest.fn((key: string, defaultValue?: any) => {
    const config = { SOME_KEY: 'value' };
    return config[key] ?? defaultValue;
  }),
};

describe('MyService', () => {
  let service: MyService;

  beforeEach(async () => {
    jest.clearAllMocks();  // Always clear between tests

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MyService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<MyService>(MyService);
  });

  it('should do something', async () => {
    mockPrisma.memory.findMany.mockResolvedValue([{ id: '1' }]);
    const result = await service.doSomething();
    expect(result).toBeDefined();
    expect(mockPrisma.memory.findMany).toHaveBeenCalled();
  });
});
```

## Pattern: Pure Service (No DI)

For services with no injected dependencies:

```typescript
describe('TemporalParserService', () => {
  let service: TemporalParserService;
  const NOW = new Date('2026-02-05T10:00:00.000Z');

  beforeEach(() => {
    service = new TemporalParserService();
  });

  it('should parse "yesterday"', () => {
    const result = service.parse('What happened yesterday?', NOW);
    expect(result.temporalFilter).not.toBeNull();
  });
});
```

## Common Mocks

### PrismaService
Mock each model's methods individually. Include `$queryRaw`, `$queryRawUnsafe`, `$executeRaw`, `$executeRawUnsafe`, `$transaction` as needed.

### LLMService
```typescript
const mockLLM = { json: jest.fn() };
```

### EmbeddingService
```typescript
const mockEmbedding = {
  generate: jest.fn(),
  search: jest.fn(),
  store: jest.fn(),
};
```

### ConfigService
Use a map-based mock with `get()` returning known test values.

## Key Conventions
- Spec files live alongside source: `foo.service.ts` → `foo.service.spec.ts`
- 57 spec files across the codebase
- `jest.clearAllMocks()` in every `beforeEach`
- Use `mockResolvedValue` / `mockRejectedValue` for async
- Test error paths — services should handle LLM timeouts, missing data gracefully
- BigInt from raw queries: remember to handle in assertions
