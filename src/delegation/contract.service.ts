import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateContractDto } from './dto/create-contract.dto';
import {
  UpdateContractDto,
  ContractStatus,
} from './dto/update-contract.dto';

const VALID_TRANSITIONS: Record<ContractStatus, ContractStatus[]> = {
  PROPOSED: ['ACCEPTED', 'REJECTED'],
  ACCEPTED: ['IN_PROGRESS'],
  IN_PROGRESS: ['COMPLETED'],
  COMPLETED: ['VERIFIED'],
  VERIFIED: [],
  REJECTED: [],
};

@Injectable()
export class ContractService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateContractDto) {
    return this.prisma.delegationContract.create({
      data: {
        userId,
        delegator: dto.delegator,
        delegate: dto.delegate,
        taskDescription: dto.taskDescription,
        terms: dto.terms as any,
        metadata: dto.metadata ?? undefined,
      },
    });
  }

  async findAll(userId: string, status?: ContractStatus) {
    const where: any = { userId };
    if (status) where.status = status;

    return this.prisma.delegationContract.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { tasks: true },
    });
  }

  async findOne(userId: string, id: string) {
    const contract = await this.prisma.delegationContract.findFirst({
      where: { id, userId },
      include: { tasks: true },
    });
    if (!contract) throw new NotFoundException('Contract not found');
    return contract;
  }

  async update(userId: string, id: string, dto: UpdateContractDto) {
    const contract = await this.prisma.delegationContract.findFirst({
      where: { id, userId },
    });
    if (!contract) throw new NotFoundException('Contract not found');

    if (dto.status) {
      const allowed = VALID_TRANSITIONS[contract.status];
      if (!allowed.includes(dto.status)) {
        throw new BadRequestException(
          `Cannot transition from ${contract.status} to ${dto.status}`,
        );
      }
    }

    const data: any = {};
    if (dto.status) {
      data.status = dto.status;
      if (dto.status === 'COMPLETED') {
        data.completedAt = new Date();
      }
      if (dto.status === 'VERIFIED') {
        data.verifiedAt = new Date();
      }
    }
    if (dto.result !== undefined) data.result = dto.result;

    return this.prisma.delegationContract.update({ where: { id }, data });
  }
}
