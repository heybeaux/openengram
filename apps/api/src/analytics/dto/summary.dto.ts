import { MemoryType, MemoryLayer } from '@prisma/client';
import { TimelineDataPoint } from './timeline-query.dto';
import { LayerDistribution } from './breakdown-query.dto';

export interface AnalyticsSummaryResponse {
  // Stats cards
  totalMemories: number;
  memoriesToday: number;
  memoriesThisWeek: number;
  avgImportance: number;

  // Timeline (last 7 days)
  timeline: TimelineDataPoint[];

  // Current distribution by type
  typeDistribution: Record<string, { count: number; percentage: number }>;

  // Layer distribution
  layerDistribution: LayerDistribution[];

  // Last updated timestamp
  lastUpdated: string;
}
