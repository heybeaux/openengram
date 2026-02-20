import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { QueryMemoryDto } from '../../memory/dto/query-memory.dto';

describe('QueryMemoryDto limit validation (HEY-206)', () => {
  it('should accept limit=10 (default)', async () => {
    const dto = plainToInstance(QueryMemoryDto, { query: 'test', limit: 10 });
    const errors = await validate(dto);
    const limitErrors = errors.filter((e) => e.property === 'limit');
    expect(limitErrors).toHaveLength(0);
  });

  it('should accept limit=1000 (max)', async () => {
    const dto = plainToInstance(QueryMemoryDto, { query: 'test', limit: 1000 });
    const errors = await validate(dto);
    const limitErrors = errors.filter((e) => e.property === 'limit');
    expect(limitErrors).toHaveLength(0);
  });

  it('should reject limit=1001 (exceeds max)', async () => {
    const dto = plainToInstance(QueryMemoryDto, { query: 'test', limit: 1001 });
    const errors = await validate(dto);
    const limitErrors = errors.filter((e) => e.property === 'limit');
    expect(limitErrors.length).toBeGreaterThan(0);
  });

  it('should reject limit=10000 (over max)', async () => {
    const dto = new QueryMemoryDto();
    dto.query = 'test';
    dto.limit = 10000;
    const errors = await validate(dto);
    const limitErrors = errors.filter((e) => e.property === 'limit');
    expect(limitErrors.length).toBeGreaterThan(0);
  });

  it('should reject limit=5000 (way over max)', async () => {
    const dto = new QueryMemoryDto();
    dto.query = 'test';
    dto.limit = 5000;
    const errors = await validate(dto);
    const limitErrors = errors.filter((e) => e.property === 'limit');
    expect(limitErrors.length).toBeGreaterThan(0);
  });
});
