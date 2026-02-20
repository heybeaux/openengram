import { AwarenessSourceService } from './awareness-source.service';

describe('AwarenessSourceService', () => {
  let service: AwarenessSourceService;

  beforeEach(() => {
    service = new AwarenessSourceService();
  });

  it('should create a source', () => {
    const result = service.create({ name: 'Linear', type: 'linear' });
    expect(result.id).toBeDefined();
    expect(result.name).toBe('Linear');
    expect(result.enabled).toBe(true);
  });

  it('should list sources', () => {
    service.create({ name: 'S1', type: 'github' });
    service.create({ name: 'S2', type: 'memory' });
    expect(service.listAll()).toHaveLength(2);
  });

  it('should get by id', () => {
    const created = service.create({ name: 'S3', type: 'linear' });
    expect(service.getById(created.id).name).toBe('S3');
  });

  it('should update a source', () => {
    const created = service.create({ name: 'S4', type: 'linear' });
    const updated = service.update(created.id, { enabled: false });
    expect(updated.enabled).toBe(false);
  });

  it('should delete a source', () => {
    const created = service.create({ name: 'S5', type: 'custom' });
    expect(service.delete(created.id).deleted).toBe(true);
    expect(() => service.getById(created.id)).toThrow();
  });
});
