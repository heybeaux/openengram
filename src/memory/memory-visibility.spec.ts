import { MemoryQueryService } from './memory-query.service';

describe('HEY-174: Scoped Memory Visibility', () => {
  describe('buildVisibilityFilter', () => {
    let service: MemoryQueryService;

    beforeEach(() => {
      // Minimal construction — we only test the pure filter builder
      service = Object.create(MemoryQueryService.prototype);
    });

    it('should return empty filter when no visibility specified (backward compatible)', () => {
      const filter = service.buildVisibilityFilter({} as any);
      expect(filter).toEqual({});
    });

    it('should filter by single visibility scope', () => {
      const filter = service.buildVisibilityFilter({
        visibility: ['PRIVATE'],
      } as any);
      expect(filter).toEqual({ visibility: { in: ['PRIVATE'] } });
    });

    it('should filter by multiple visibility scopes', () => {
      const filter = service.buildVisibilityFilter({
        visibility: ['TEAM', 'PUBLIC'],
      } as any);
      expect(filter).toEqual({ visibility: { in: ['TEAM', 'PUBLIC'] } });
    });

    it('should return empty filter for empty visibility array', () => {
      const filter = service.buildVisibilityFilter({
        visibility: [],
      } as any);
      expect(filter).toEqual({});
    });

    it('should support all three visibility levels', () => {
      const filter = service.buildVisibilityFilter({
        visibility: ['PRIVATE', 'TEAM', 'PUBLIC'],
      } as any);
      expect(filter).toEqual({
        visibility: { in: ['PRIVATE', 'TEAM', 'PUBLIC'] },
      });
    });
  });

  describe('CreateMemoryDto visibility field', () => {
    const { CreateMemoryDto } = require('./dto/create-memory.dto');

    it('should accept valid visibility values', () => {
      const dto = new CreateMemoryDto();
      dto.raw = 'test memory';
      dto.visibility = 'TEAM';
      expect(dto.visibility).toBe('TEAM');
    });

    it('should default visibility to undefined (service defaults to PRIVATE)', () => {
      const dto = new CreateMemoryDto();
      dto.raw = 'test memory';
      expect(dto.visibility).toBeUndefined();
    });
  });
});
