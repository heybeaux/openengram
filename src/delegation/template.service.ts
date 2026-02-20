import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';

@Injectable()
export class TemplateService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateTemplateDto) {
    return this.prisma.delegationTemplate.create({
      data: {
        userId,
        name: dto.name,
        taskType: dto.taskType,
        requiredCapabilities: dto.requiredCapabilities ?? [],
        defaultInstructions: dto.defaultInstructions,
        expectedOutputs: dto.expectedOutputs,
        typicalDurationMs: dto.typicalDurationMs,
        metadata: dto.metadata ?? undefined,
      },
    });
  }

  async findAll(userId: string) {
    return this.prisma.delegationTemplate.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(userId: string, id: string) {
    const template = await this.prisma.delegationTemplate.findFirst({
      where: { id, userId },
    });
    if (!template) throw new NotFoundException('Template not found');
    return template;
  }

  async update(userId: string, id: string, dto: UpdateTemplateDto) {
    const template = await this.prisma.delegationTemplate.findFirst({
      where: { id, userId },
    });
    if (!template) throw new NotFoundException('Template not found');

    return this.prisma.delegationTemplate.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.taskType !== undefined && { taskType: dto.taskType }),
        ...(dto.requiredCapabilities !== undefined && {
          requiredCapabilities: dto.requiredCapabilities,
        }),
        ...(dto.defaultInstructions !== undefined && {
          defaultInstructions: dto.defaultInstructions,
        }),
        ...(dto.expectedOutputs !== undefined && {
          expectedOutputs: dto.expectedOutputs,
        }),
        ...(dto.typicalDurationMs !== undefined && {
          typicalDurationMs: dto.typicalDurationMs,
        }),
        ...(dto.metadata !== undefined && { metadata: dto.metadata }),
      },
    });
  }

  async remove(userId: string, id: string) {
    const template = await this.prisma.delegationTemplate.findFirst({
      where: { id, userId },
    });
    if (!template) throw new NotFoundException('Template not found');

    await this.prisma.delegationTemplate.delete({ where: { id } });
    return { deleted: true };
  }
}
