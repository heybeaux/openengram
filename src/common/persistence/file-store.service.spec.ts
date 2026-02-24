import { FileStoreService } from './file-store.service';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('FileStoreService', () => {
  let service: FileStoreService;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-store-test-'));
    service = new FileStoreService();
    // Override dataDir for testing
    (service as any).dataDir = tmpDir;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should return empty map when file does not exist', () => {
    const map = service.load('nonexistent.json');
    expect(map.size).toBe(0);
  });

  it('should save and load a map', async () => {
    const original = new Map<string, { name: string; value: number }>();
    original.set('a', { name: 'Alice', value: 1 });
    original.set('b', { name: 'Bob', value: 2 });

    await service.save('test.json', original);

    const loaded = service.load<string, { name: string; value: number }>('test.json');
    expect(loaded.size).toBe(2);
    expect(loaded.get('a')).toEqual({ name: 'Alice', value: 1 });
    expect(loaded.get('b')).toEqual({ name: 'Bob', value: 2 });
  });

  it('should overwrite on save', async () => {
    const map1 = new Map([['x', 1]]);
    await service.save('overwrite.json', map1);

    const map2 = new Map([['y', 2], ['z', 3]]);
    await service.save('overwrite.json', map2);

    const loaded = service.load<string, number>('overwrite.json');
    expect(loaded.size).toBe(2);
    expect(loaded.has('x')).toBe(false);
    expect(loaded.get('y')).toBe(2);
  });

  it('should handle corrupted files gracefully', () => {
    fs.writeFileSync(path.join(tmpDir, 'bad.json'), '{not valid json[[[', 'utf-8');
    const map = service.load('bad.json');
    expect(map.size).toBe(0);
  });

  it('should write atomically via temp file', async () => {
    const map = new Map([['key', 'value']]);
    await service.save('atomic.json', map);

    // Temp file should not exist after save
    expect(fs.existsSync(path.join(tmpDir, 'atomic.json.tmp'))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, 'atomic.json'))).toBe(true);
  });

  it('should create data directory on init', () => {
    const newDir = path.join(tmpDir, 'subdir');
    (service as any).dataDir = newDir;
    service.onModuleInit();
    expect(fs.existsSync(newDir)).toBe(true);
  });
});
