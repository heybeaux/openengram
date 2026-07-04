"use client";

import { useState, useEffect, useCallback } from "react";
import { engram } from "@/lib/engram-client";
import type { HealthMetrics } from "@/lib/types";

// The API returns metrics as an array of { key, value, unit, status, description }.
// Backend percentage metrics use 0-100 values with unit "%"; the dashboard
// cards expect ratios (0-1) before rendering them as percentages.
type ApiMetric = { value?: unknown; unit?: unknown };

function metricValue(metric: unknown): unknown {
  if (metric && typeof metric === "object" && "value" in metric) {
    return (metric as ApiMetric).value;
  }
  return metric;
}

function numberMetric(metric: unknown, fallback = 0): number {
  const value = metricValue(metric);
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clampRatio(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function percentMetricToRatio(metric: unknown): number {
  const value = numberMetric(metric);
  const unit = metric && typeof metric === "object" ? (metric as ApiMetric).unit : undefined;

  if (unit === "%") return clampRatio(value / 100);

  // Preserve compatibility with older mocked/dev responses that already used
  // ratios, while normalizing legacy percent payloads where unit was absent.
  return clampRatio(value > 1 ? value / 100 : value);
}

function transformMetrics(raw: unknown): HealthMetrics {
  const arr = Array.isArray(raw) ? raw : [];
  const map = new Map<string, unknown>();
  for (const m of arr) {
    if (m && typeof m === "object" && "key" in m && "value" in m) {
      map.set(m.key as string, m);
    }
  }

  const layerDist = metricValue(map.get("layer_distribution"));
  const totalMemories =
    layerDist && typeof layerDist === "object"
      ? Object.values(layerDist as Record<string, number>).reduce((a, b) => a + b, 0)
      : 0;
  const staleRatio = percentMetricToRatio(map.get("stale_memories_pct"));

  return {
    memoryCount: totalMemories,
    embeddingCoverage: percentMetricToRatio(map.get("embedding_coverage_pct")),
    dedupPendingClusters: numberMetric(map.get("dedup_pending_clusters")),
    avgRecallLatencyMs: numberMetric(map.get("avg_recall_latency_ms")),
    dreamCycleStatus: (metricValue(map.get("dream_cycle_status")) as string) ?? "unknown",
    dreamCycleLastRun: (metricValue(map.get("dream_cycle_last_run")) as string) ?? "",
    decayPercentage: staleRatio,
    freshnessPercentage: Math.max(0, 1 - staleRatio),
  };
}

export function useHealthMetrics() {
  const [data, setData] = useState<HealthMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await engram.getHealthMetrics();
      // API returns { metrics: [...] } array — transform to flat object
      setData(transformMetrics(result.metrics));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch health metrics";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await engram.refreshHealthMetrics();
      await fetchMetrics();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to refresh health metrics";
      setError(message);
    } finally {
      setRefreshing(false);
    }
  }, [fetchMetrics]);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  return { data, loading, error, refreshing, refetch: fetchMetrics, refresh };
}
