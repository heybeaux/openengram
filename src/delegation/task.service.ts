import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { QueryTaskDto } from './dto/query-task.dto';

@Injectable()
export class TaskService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateTaskDto) {
    return this.prisma.delegatedTask.create({
      data: {
        userId,
        assignedTo: dto.assignedTo,
        assignedBy: dto.assignedBy,
        taskDescription: dto.taskDescription,
        deadline: dto.deadline ? new Date(dto.deadline) : undefined,
        metadata: dto.metadata ?? undefined,
        templateId: dto.templateId,
        contractId: dto.contractId,
      },
    });
  }

  async update(userId: string, id: string, dto: UpdateTaskDto) {
    const task = await this.prisma.delegatedTask.findFirst({
      where: { id, userId },
    });
    if (!task) throw new NotFoundException('Task not found');

    const data: any = {};
    if (dto.status) {
      data.status = dto.status;
      if (dto.status === 'COMPLETED' || dto.status === 'FAILED') {
        data.completedAt = new Date();
      }
    }
    if (dto.result !== undefined) data.result = dto.result;

    return this.prisma.delegatedTask.update({ where: { id }, data });
  }

  async findAll(userId: string, query: QueryTaskDto) {
    const where: any = { userId };
    if (query.status) where.status = query.status;
    if (query.assignedTo) where.assignedTo = query.assignedTo;
    if (query.assignedBy) where.assignedBy = query.assignedBy;
    if (query.contractId) where.contractId = query.contractId;

    return this.prisma.delegatedTask.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { template: true, contract: true },
    });
  }

  async findOne(userId: string, id: string) {
    const task = await this.prisma.delegatedTask.findFirst({
      where: { id, userId },
      include: { template: true, contract: true },
    });
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }
}
