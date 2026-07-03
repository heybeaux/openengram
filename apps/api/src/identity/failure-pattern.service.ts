import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  FailurePattern,
  FailurePatternType,
  DelegationContract,
} from './identity.types';
import { DelegationContractService } from './delegation-contract.service';

/**
 * FailurePatternService (HEY-187)
 *
 * Analyzes completed delegation contracts (TASK_COMPLETION memories)
 * for recurring failure patterns:
 * - Repeated failures by same agent on same domain
 * - Cascading failures (multiple agents failing on related tasks)
 * - Timeout patterns (agent consistently timing out)
 *
 * Detected patterns are stored as INSIGHT memories via the awareness integration.
 */
@Injectable()
export class FailurePatternService {
  private readonly logger = new Logger(FailurePatternService.name);
  private readonly detectedPatterns: FailurePattern[] = [];

  static readonly REPEATED_FAILURE_THRESHOLD = 2;
  static readonly TIMEOUT_PATTERN_THRESHOLD = 2;
  static readonly CASCADE_THRESHOLD = 3;

  /** Callback to create insight memories */
  private createMemoryFn?: (
    userId: string,
    dto: {
      raw: string;
      layer: string;
      memoryType: string;
      agentId?: string;
      source: string;
    },
  ) => Promise<any>;

  setCreateMemoryFn(
    fn: (
      userId: string,
      dto: {
        raw: string;
        layer: string;
        memoryType: string;
        agentId?: string;
        source: string;
      },
    ) => Promise<any>,
  ): void {
    this.createMemoryFn = fn;
  }

  /**
   * Analyze contracts from a DelegationContractService for failure patterns.
   * Called during Waking Cycle or on-demand.
   */
  async analyze(
    contractService: DelegationContractService,
  ): Promise<FailurePattern[]> {
    const finalized = contractService.getFinalized();
    const newPatterns: FailurePattern[] = [];

    // 1. Repeated failures by same agent
    const byAgent = new Map<string, DelegationContract[]>();
    for (const c of finalized) {
      if (c.status === 'failed') {
        const key = c.delegatedTo;
        if (!byAgent.has(key)) byAgent.set(key, []);
        byAgent.get(key)!.push(c);
      }
    }

    for (const [agentId, failures] of byAgent) {
      if (failures.length >= FailurePatternService.REPEATED_FAILURE_THRESHOLD) {
        const existing = this.detectedPatterns.find(
          (p) =>
            p.patternType === 'repeated_agent_failure' && p.agentId === agentId,
        );
        if (!existing) {
          const pattern: FailurePattern = {
            id: randomUUID(),
            patternType: 'repeated_agent_failure',
            agentId,
            description: `Agent ${agentId} has ${failures.length} repeated failures`,
            occurrences: failures.length,
            contractIds: failures.map((f) => f.id),
            detectedAt: new Date(),
          };
          this.detectedPatterns.push(pattern);
          newPatterns.push(pattern);
        }
      }
    }

    // 2. Timeout patterns
    const timeoutsByAgent = new Map<string, DelegationContract[]>();
    for (const c of finalized) {
      if (c.status === 'timed_out') {
        if (!timeoutsByAgent.has(c.delegatedTo))
          timeoutsByAgent.set(c.delegatedTo, []);
        timeoutsByAgent.get(c.delegatedTo)!.push(c);
      }
    }

    for (const [agentId, timeouts] of timeoutsByAgent) {
      if (timeouts.length >= FailurePatternService.TIMEOUT_PATTERN_THRESHOLD) {
        const existing = this.detectedPatterns.find(
          (p) => p.patternType === 'timeout_pattern' && p.agentId === agentId,
        );
        if (!existing) {
          const pattern: FailurePattern = {
            id: randomUUID(),
            patternType: 'timeout_pattern',
            agentId,
            description: `Agent ${agentId} has ${timeouts.length} timeout failures`,
            occurrences: timeouts.length,
            contractIds: timeouts.map((t) => t.id),
            detectedAt: new Date(),
          };
          this.detectedPatterns.push(pattern);
          newPatterns.push(pattern);
        }
      }
    }

    // 3. Cascading failures (multiple different agents failing on similar tasks)
    const allFailures = finalized.filter(
      (c) => c.status === 'failed' || c.status === 'timed_out',
    );
    if (allFailures.length >= FailurePatternService.CASCADE_THRESHOLD) {
      const uniqueAgents = new Set(allFailures.map((f) => f.delegatedTo));
      if (uniqueAgents.size >= 2) {
        const existing = this.detectedPatterns.find(
          (p) => p.patternType === 'cascading_failure',
        );
        if (!existing) {
          const pattern: FailurePattern = {
            id: randomUUID(),
            patternType: 'cascading_failure',
            agentId: 'multiple',
            description: `Cascading failures across ${uniqueAgents.size} agents (${allFailures.length} total failures)`,
            occurrences: allFailures.length,
            contractIds: allFailures.map((f) => f.id),
            detectedAt: new Date(),
          };
          this.detectedPatterns.push(pattern);
          newPatterns.push(pattern);
        }
      }
    }

    // Store new patterns as INSIGHT memories
    for (const pattern of newPatterns) {
      await this.storeAsInsight(pattern);
    }

    return newPatterns;
  }

  getPatterns(agentId?: string): FailurePattern[] {
    if (agentId) {
      return this.detectedPatterns.filter((p) => p.agentId === agentId);
    }
    return [...this.detectedPatterns];
  }

  private async storeAsInsight(pattern: FailurePattern): Promise<void> {
    if (!this.createMemoryFn) {
      this.logger.warn('No createMemoryFn set — skipping INSIGHT memory');
      return;
    }

    try {
      const raw = [
        `FAILURE PATTERN DETECTED: ${pattern.patternType}`,
        `Agent: ${pattern.agentId}`,
        pattern.description,
        `Occurrences: ${pattern.occurrences}`,
        `Contracts: ${pattern.contractIds.join(', ')}`,
      ].join('\n');

      await this.createMemoryFn('system', {
        raw,
        layer: 'INSIGHT',
        memoryType: 'LESSON',
        agentId: pattern.agentId !== 'multiple' ? pattern.agentId : undefined,
        source: 'SYSTEM_GENERATED',
      });

      this.logger.log(`INSIGHT memory created for pattern ${pattern.id}`);
    } catch (err) {
      this.logger.error(`Failed to create INSIGHT memory: ${err}`);
    }
  }
}
