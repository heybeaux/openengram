import { AwarenessSourceController } from './awareness-source.controller';
import { AwarenessSourceService } from './awareness-source.service';

describe('AwarenessSourceController (Sources CRUD)', () => {
  let controller: AwarenessSourceController;
  let service: AwarenessSourceService;

  beforeEach(() => {
    service = new AwarenessSourceService();
    controller = new AwarenessSourceController(service);
  });

  it('should list sources (initially empty)', async () => {
    const list = await controller.list();
    expect(Array.isArray(list)).toBe(true);
  });

  it('should create a source', async () => {
    const result = await controller.create({
      name: 'Custom Source',
      type: 'custom',
      config: { url: 'https://example.com' },
    });
    expect(result.id).toBeDefined();
    expect(result.name).toBe('Custom Source');
  });

  it('should get source by id', async () => {
    const created = await controller.create({
      name: 'Test',
      type: 'custom',
    });
    const fetched = await controller.getById(created.id);
    expect(fetched.id).toBe(created.id);
  });

  it('should update a source via PUT', async () => {
    const created = await controller.create({
      name: 'Old',
      type: 'custom',
    });
    const updated = await controller.update(created.id, {
      name: 'New',
      enabled: false,
    });
    expect(updated.name).toBe('New');
    expect(updated.enabled).toBe(false);
  });

  it('should delete a source', async () => {
    const created = await controller.create({
      name: 'ToDelete',
      type: 'custom',
    });
    await controller.delete(created.id);
    expect(() => service.getById(created.id)).toThrow();
  });

  it('should get source status', async () => {
    const created = await controller.create({
      name: 'StatusTest',
      type: 'github',
    });
    const status = await controller.getStatus(created.id);
    expect(status.id).toBe(created.id);
    expect(status.healthy).toBe(true);
    expect(status.enabled).toBe(true);
    expect(status.lastChecked).toBeDefined();
  });

  it('should report unhealthy for disabled source', async () => {
    const created = await controller.create({
      name: 'Disabled',
      type: 'linear',
      enabled: false,
    });
    const status = await controller.getStatus(created.id);
    expect(status.healthy).toBe(false);
    expect(status.enabled).toBe(false);
  });
});
