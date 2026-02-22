import { Injectable, Logger } from '@nestjs/common';
import { AnticipatoryConfig } from './anticipatory.config';
import { ContextSignals } from './strategies/strategy.interface';

/**
 * Strategy Selector
 *
 * Given context signals, picks at most 2 strategies to run.
 * No database queries — pure signal scoring.
 */
@Injectable()
export class StrategySelectorService {
  private readonly logger = new Logger(StrategySelectorService.name);

  /**
   * Select strategies to run based on signal strength.
   * Returns strategy names sorted by expected value (weight × signal strength).
   */
  select(
    signals: ContextSignals,
    overrides?: string[],
    weights?: Record<string, number>,
  ): string[] {
    // If caller explicitly chose strategies, respect that
    if (overrides && overrides.length > 0) {
      return overrides.filter((s) => this.isEnabled(s)).slice(0, 2);
    }

    const w = weights ?? AnticipatoryConfig.defaultWeights;
    const candidates: Array<{ name: string; score: number }> = [];

    // Entity Radiation: score based on entity presence
    if (this.isEnabled('entity_radiation') && signals.entities.length > 0) {
      const signalStrength = Math.min(1.0, signals.entities.length * 0.5);
      candidates.push({
        name: 'entity_radiation',
        score: (w.entity_radiation ?? 1.0) * signalStrength,
      });
    }

    // Insight Injection: score based on topic/entity presence (either works)
    if (
      this.isEnabled('insight_injection') &&
      (signals.topics.length > 0 || signals.entities.length > 0)
    ) {
      const signalStrength = Math.min(
        1.0,
        signals.topics.length * 0.3 + signals.entities.length * 0.3,
      );
      candidates.push({
        name: 'insight_injection',
        score: (w.insight_injection ?? 0.8) * Math.max(0.3, signalStrength),
      });
    }

    // Contradiction Surfacing (Phase 2): score based on topic presence
    if (this.isEnabled('contradiction_surfacing') && signals.topics.length > 0) {
      const signalStrength = Math.min(1.0, signals.topics.length * 0.4);
      candidates.push({
        name: 'contradiction_surfacing',
        score: (w.contradiction_surfacing ?? 0.5) * signalStrength,
      });
    }

    // Behavioral Sequence (Phase 3): score based on temporal + topic signals
    if (this.isEnabled('behavioral_sequence') && signals.topics.length > 0) {
      candidates.push({
        name: 'behavioral_sequence',
        score: (w.behavioral_sequence ?? 0.3) * 0.5,
      });
    }

    // Sort by score descending, take top 2
    return candidates
      .sort((a, b) => b.score - a.score)
      .slice(0, 2)
      .map((c) => c.name);
  }

  private isEnabled(strategy: string): boolean {
    const strategyMap: Record<string, boolean> = {
      entity_radiation: AnticipatoryConfig.strategies.entityRadiation,
      insight_injection: AnticipatoryConfig.strategies.insightInjection,
      contradiction_surfacing: AnticipatoryConfig.strategies.contradictionSurfacing,
      behavioral_sequence: AnticipatoryConfig.strategies.behavioralSequence,
    };
    return strategyMap[strategy] ?? false;
  }
}
