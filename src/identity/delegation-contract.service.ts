import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  DelegationContract,
  CreateContractDto,
  CompleteContractDto,
  ContractStatus,
} from './identity.types';
import { ChallengeService } from './challenge.service';

/**
 * DelegationContractService (HEY-185)
 *
 * Manages delegation contracts — verification criteria and constraints
 * required before spawning sub-agents. When a contract completes,
 * auto-creates a TASK_COMPLETION memory via the provided callback.
 *
 * Contracts are stored in-memory. For production persistence, a
 * DelegationContract Prisma model is recommended (see migration notes).
 */
@Injectable()
export class DelegationContractService {
  private readonly logger = new Logger(DelegationContractService.name);
  private readonly contracts = new Map<string, DelegationContract>();

  /** Callback to create a memory when a contract completes */
  private createMemoryFn?: (
    userId: string,
    dto: { raw: string; layer: string; memoryType: string; agentId: string; source: string },
  ) => Promise<any>;

  private challengeService?: ChallengeService;

  setChallengeService(challengeService: ChallengeService): void {
    this.challengeService = challengeService;
  }

  setCreateMemoryFn(
    fn: (
      userId: string,
      dto: { raw: string; layer: string; memoryType: string; agentId: string; source: string },
    ) => Promise<any>,
  ): void {
    this.createMemoryFn = fn;
  }

  async create(dto: CreateContractDto): Promise<DelegationContract> {
    const contract: DelegationContract = {
      id: randomUUID(),
      taskDescription: dto.taskDescription,
      expectedOutputs: dto.expectedOutputs,
      successCriteria: dto.successCriteria,
      timeout: dto.timeout,
      constraints: dto.constraints || [],
      delegatedTo: dto.delegatedTo,
      status: 'pending',
      createdAt: new Date(),
      accountId: dto.accountId,
    };

    this.contracts.set(contract.id, contract);
    this.logger.log(`Contract ${contract.id} created for agent ${contract.delegatedTo}`);

    // Schedule timeout
    setTimeout(() => this.handleTimeout(contract.id), contract.timeout);

    // Auto-challenge check via ChallengeService
    if (this.challengeService) {
      await this.challengeService.autoCheckCapability(contract);
    }

    return contract;
  }

  getById(id: string): DelegationContract {
    const contract = this.contracts.get(id);
    if (!contract) throw new NotFoundException(`Contract ${id} not found`);
    return contract;
  }

  listAll(): DelegationContract[] {
    return Array.from(this.contracts.values());
  }

  async complete(id: string, dto: CompleteContractDto): Promise<DelegationContract> {
    const contract = this.getById(id);
    if (contract.status === 'completed' || contract.status === 'failed' || contract.status === 'timed_out') {
      throw new Error(`Contract ${id} already finalized with status: ${contract.status}`);
    }

    contract.status = dto.status;
    contract.result = dto.result;
    contract.completedAt = new Date();

    this.logger.log(`Contract ${id} completed with status: ${dto.status}`);

    // Auto-create TASK_COMPLETION memory
    await this.createTaskCompletionMemory(contract);

    return contract;
  }

  private async createTaskCompletionMemory(contract: DelegationContract): Promise<void> {
    if (!this.createMemoryFn) {
      this.logger.warn('No createMemoryFn set — skipping TASK_COMPLETION memory');
      return;
    }

    try {
      const raw = [
        `TASK_COMPLETION: ${contract.taskDescription}`,
        `Status: ${contract.status}`,
        `Agent: ${contract.delegatedTo}`,
        contract.result ? `Result: ${contract.result}` : '',
        `Expected outputs: ${contract.expectedOutputs.join(', ')}`,
        `Success criteria: ${contract.successCriteria.join(', ')}`,
      ]
        .filter(Boolean)
        .join('\n');

      await this.createMemoryFn('system', {
        raw,
        layer: 'TASK',
        memoryType: 'TASK',
        agentId: contract.delegatedTo,
        source: 'SYSTEM_GENERATED',
      });

      this.logger.log(`TASK_COMPLETION memory created for contract ${contract.id}`);
    } catch (err) {
      this.logger.error(`Failed to create TASK_COMPLETION memory: ${err}`);
    }
  }

  private handleTimeout(id: string): void {
    const contract = this.contracts.get(id);
    if (!contract || contract.status !== 'pending' && contract.status !== 'in_progress') return;

    contract.status = 'timed_out';
    contract.completedAt = new Date();
    this.logger.warn(`Contract ${id} timed out`);

    this.createTaskCompletionMemory(contract).catch((err) =>
      this.logger.error(`Failed to create timeout memory: ${err}`),
    );
  }

  /** Get all contracts for a specific agent (for failure pattern analysis) */
  getByAgent(agentId: string): DelegationContract[] {
    return Array.from(this.contracts.values()).filter((c) => c.delegatedTo === agentId);
  }

  /** Get completed/failed contracts for analysis */
  getFinalized(): DelegationContract[] {
    return Array.from(this.contracts.values()).filter(
      (c) => c.status === 'completed' || c.status === 'failed' || c.status === 'timed_out',
    );
  }
}
