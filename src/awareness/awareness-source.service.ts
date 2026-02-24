import { Injectable, Logger, NotFoundException, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'crypto';

export interface SignalSourceConfig {
  id: string;
  name: string;
  type: 'linear' | 'github' | 'memory' | 'custom';
  enabled: boolean;
  config: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * AwarenessSourceService (HEY-286)
 *
 * CRUD for awareness signal source configurations.
 * In-memory store — production should persist to DB.
 */
@Injectable()
export class AwarenessSourceService implements OnModuleDestroy {
  private readonly logger = new Logger(AwarenessSourceService.name);
  private readonly sources = new Map<string, SignalSourceConfig>();

  onModuleDestroy(): void {
    if (this.sources.size > 0) {
      this.logger.warn(
        `Shutting down with ${this.sources.size} awareness source config(s) being discarded`,
      );
    }
  }

  create(dto: {
    name: string;
    type: 'linear' | 'github' | 'memory' | 'custom';
    enabled?: boolean;
    config?: Record<string, any>;
  }): SignalSourceConfig {
    const source: SignalSourceConfig = {
      id: randomUUID(),
      name: dto.name,
      type: dto.type,
      enabled: dto.enabled ?? true,
      config: dto.config || {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.sources.set(source.id, source);
    this.logger.log(`Created signal source "${source.name}" (${source.type})`);
    return source;
  }

  listAll(): SignalSourceConfig[] {
    return Array.from(this.sources.values());
  }

  getById(id: string): SignalSourceConfig {
    const source = this.sources.get(id);
    if (!source) throw new NotFoundException(`Signal source ${id} not found`);
    return source;
  }

  update(
    id: string,
    dto: { name?: string; enabled?: boolean; config?: Record<string, any> },
  ): SignalSourceConfig {
    const source = this.getById(id);
    if (dto.name !== undefined) source.name = dto.name;
    if (dto.enabled !== undefined) source.enabled = dto.enabled;
    if (dto.config !== undefined) source.config = { ...source.config, ...dto.config };
    source.updatedAt = new Date();
    return source;
  }

  getStatus(id: string): { id: string; name: string; type: string; enabled: boolean; healthy: boolean; lastChecked: string; message: string } {
    const source = this.getById(id);
    // Basic health check — in production this would ping the actual integration
    return {
      id: source.id,
      name: source.name,
      type: source.type,
      enabled: source.enabled,
      healthy: source.enabled,
      lastChecked: new Date().toISOString(),
      message: source.enabled ? 'Source is configured and active' : 'Source is disabled',
    };
  }

  delete(id: string): { deleted: true } {
    const source = this.getById(id);
    this.sources.delete(id);
    this.logger.log(`Deleted signal source "${source.name}"`);
    return { deleted: true };
  }
}
