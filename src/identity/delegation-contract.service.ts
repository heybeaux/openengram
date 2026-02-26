import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  DelegationContract,
  CreateContractDto,
  CompleteContractDto,
  ContractStatus,
} from './identity.types';
import { ChallengeService } from './challenge.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * DelegationContractService (HEY-185)
 *
 * Manages delegation contracts — verification criteria and constraints
 * required before spawning sub-agents. When a contract completes,
 * auto-creates a TASK_COMPLETION memory via the provided callback.
 *
 * Contracts are persisted to PostgreSQL via Prisma (HEY-385).
 */
@Injectable()
export class DelegationContractService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(DelegationContractService.name);
  private contracts = new Map<string, DelegationContract>();
  private readonly timers = new Map<string, NodeJS.Timeout>();

  /** Callback to create a memory when a contract completes */
  private createMemoryFn?: (
    userId: string,
    dto: {
      raw: string;
      layer: string;
      memoryType: string;
      agentId: string;
      source: string;
    },
  ) => Promise<any>;

  private challengeService?: ChallengeService;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    try {
      const rows = await this.prisma.identityContract.findMany();
      for (const row of rows) {
        this.contracts.set(row.id, {
          id: row.id,
          taskDescription: row.taskDescription,
          expectedOutputs: row.expectedOutputs,
          successCriteria: row.successCriteria,
          timeout: row.timeout,
          constraints: row.constraints,
          delegatedTo: row.delegatedTo,
          status: row.status as ContractStatus,
          result: row.result ?? undefined,
          createdAt: row.createdAt,
          completedAt: row.completedAt ?? undefined,
          accountId: row.accountId ?? undefined,
        });
      }
      if (this.contracts.size > 0) {
        this.logger.log(
          `Loaded ${this.contracts.size} delegation contracts from database`,
        );
      }
    } catch (err) {
      this.logger.warn(`Failed to load contracts from database: ${err}`);
    }
  }

  private persist(contract: DelegationContract): void {
    this.prisma.identityContract
      .upsert({
        where: { id: contract.id },
        create: {
          id: contract.id,
          taskDescription: contract.taskDescription,
          expectedOutputs: contract.expectedOutputs,
          successCriteria: contract.successCriteria,
          timeout: contract.timeout,
          constraints: contract.constraints,
          delegatedTo: contract.delegatedTo,
          status: contract.status,
          result: contract.result ?? null,
          completedAt: contract.completedAt ?? null,
          accountId: contract.accountId ?? null,
          createdAt: contract.createdAt,
        },
        update: {
          taskDescription: contract.taskDescription,
          expectedOutputs: contract.expectedOutputs,
          successCriteria: contract.successCriteria,
          constraints: contract.constraints,
          status: contract.status,
          result: contract.result ?? null,
          completedAt: contract.completedAt ?? null,
        },
      })
      .catch((err) =>
        this.logger.warn(`Failed to persist contract: ${err.message}`),
      );
  }

  setChallengeService(challengeService: ChallengeService): void {
    this.challengeService = challengeService;
  }

  setCreateMemoryFn(
    fn: (
      userId: string,
      dto: {
        raw: string;
        layer: string;
        memoryType: string;
        agentId: string;
        source: string;
      },
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
    this.persist(contract);
    this.logger.log(
      `Contract ${contract.id} created for agent ${contract.delegatedTo}`,
    );

    // Schedule timeout
    const timer = setTimeout(
      () => this.handleTimeout(contract.id),
      contract.timeout * 1000,
    );
    timer.unref();
    this.timers.set(contract.id, timer);

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

  update(
    id: string,
    dto: Partial<CreateContractDto> & { status?: ContractStatus },
  ): DelegationContract {
    const contract = this.getById(id);
    if (dto.taskDescription !== undefined)
      contract.taskDescription = dto.taskDescription;
    if (dto.expectedOutputs !== undefined)
      contract.expectedOutputs = dto.expectedOutputs;
    if (dto.successCriteria !== undefined)
      contract.successCriteria = dto.successCriteria;
    if (dto.constraints !== undefined) contract.constraints = dto.constraints;
    if (dto.status !== undefined) contract.status = dto.status;
    this.persist(contract);
    this.logger.log(`Contract ${id} updated`);
    return contract;
  }

  listAll(): DelegationContract[] {
    return Array.from(this.contracts.values());
  }

  async complete(
    id: string,
    dto: CompleteContractDto,
  ): Promise<DelegationContract> {
    const contract = this.getById(id);
    if (
      contract.status === 'completed' ||
      contract.status === 'failed' ||
      contract.status === 'timed_out'
    ) {
      throw new Error(
        `Contract ${id} already finalized with status: ${contract.status}`,
      );
    }

    contract.status = dto.status;
    contract.result = dto.result;
    contract.completedAt = new Date();

    // Clear the timeout timer
    this.clearTimer(id);
    this.persist(contract);

    this.logger.log(`Contract ${id} completed with status: ${dto.status}`);

    // Auto-create TASK_COMPLETION memory
    await this.createTaskCompletionMemory(contract);

    return contract;
  }

  private async createTaskCompletionMemory(
    contract: DelegationContract,
  ): Promise<void> {
    if (!this.createMemoryFn) {
      this.logger.warn(
        'No createMemoryFn set — skipping TASK_COMPLETION memory',
      );
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

      this.logger.log(
        `TASK_COMPLETION memory created for contract ${contract.id}`,
      );
    } catch (err) {
      this.logger.error(`Failed to create TASK_COMPLETION memory: ${err}`);
    }
  }

  private handleTimeout(id: string): void {
    this.timers.delete(id);
    const contract = this.contracts.get(id);
    if (
      !contract ||
      (contract.status !== 'pending' && contract.status !== 'in_progress')
    )
      return;

    contract.status = 'timed_out';
    contract.completedAt = new Date();
    this.persist(contract);
    this.logger.warn(`Contract ${id} timed out`);

    this.createTaskCompletionMemory(contract).catch((err) =>
      this.logger.error(`Failed to create timeout memory: ${err}`),
    );
  }

  onModuleDestroy(): void {
    for (const [id, timer] of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  private clearTimer(id: string): void {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
  }

  /** Get all contracts for a specific agent (for failure pattern analysis) */
  getByAgent(agentId: string): DelegationContract[] {
    return Array.from(this.contracts.values()).filter(
      (c) => c.delegatedTo === agentId,
    );
  }

  /** Get completed/failed contracts for analysis */
  getFinalized(): DelegationContract[] {
    return Array.from(this.contracts.values()).filter(
      (c) =>
        c.status === 'completed' ||
        c.status === 'failed' ||
        c.status === 'timed_out',
    );
  }
}
