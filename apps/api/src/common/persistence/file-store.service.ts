import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Generic JSON file-based persistence for in-memory Maps.
 *
 * Provides load/save operations for services that need to survive restarts
 * but don't yet have dedicated database tables. Data is stored as JSON files
 * in the `data/` directory at the project root.
 *
 * Thread-safety: writes are serialized per file path via a simple lock flag.
 * This is sufficient for single-instance deployments.
 */
@Injectable()
export class FileStoreService implements OnModuleInit {
  private readonly logger = new Logger(FileStoreService.name);
  private readonly dataDir: string;
  private writing = new Set<string>();

  constructor() {
    this.dataDir = path.resolve(process.cwd(), 'data');
  }

  onModuleInit(): void {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
      this.logger.log(`Created data directory: ${this.dataDir}`);
    }
  }

  /**
   * Load a Map from a JSON file. Returns an empty Map if the file doesn't exist.
   */
  load<K extends string, V>(filename: string): Map<K, V> {
    const filePath = path.join(this.dataDir, filename);
    try {
      if (!fs.existsSync(filePath)) {
        return new Map();
      }
      const raw = fs.readFileSync(filePath, 'utf-8');
      const entries: [K, V][] = JSON.parse(raw);
      this.logger.log(`Loaded ${entries.length} entries from ${filename}`);
      return new Map(entries);
    } catch (err: any) {
      this.logger.warn(`Failed to load ${filename}: ${err.message}`);
      return new Map();
    }
  }

  /**
   * Save a Map to a JSON file. Writes atomically via temp file + rename.
   */
  async save<K extends string, V>(
    filename: string,
    map: Map<K, V>,
  ): Promise<void> {
    const filePath = path.join(this.dataDir, filename);

    // Simple write serialization per file
    if (this.writing.has(filename)) {
      return; // Skip concurrent writes — next mutation will persist
    }

    this.writing.add(filename);
    try {
      const entries = Array.from(map.entries());
      const json = JSON.stringify(entries, null, 2);
      const tmpPath = `${filePath}.tmp`;
      fs.writeFileSync(tmpPath, json, 'utf-8');
      fs.renameSync(tmpPath, filePath);
    } catch (err: any) {
      this.logger.error(`Failed to save ${filename}: ${err.message}`);
    } finally {
      this.writing.delete(filename);
    }
  }

  /** Get the full path for a data file (for testing). */
  getFilePath(filename: string): string {
    return path.join(this.dataDir, filename);
  }

  /** Get the data directory path. */
  getDataDir(): string {
    return this.dataDir;
  }
}
