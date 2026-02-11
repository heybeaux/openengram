import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateAgentSessionDto,
  UpdateAgentSessionDto,
} from './dto/agent-session.dto';
import { AgentSessionStatus } from '@prisma/client';

@Injectable()
export class AgentSessionService {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(dto: CreateAgentSessionDto) {
    return this.prisma.agentSession.upsert({
      where: { sessionKey: dto.sessionKey },
      update: {
        label: dto.label,
        taskDescription: dto.taskDescription,
        status: 'ACTIVE',
        endedAt: null,
      },
      create: {
        sessionKey: dto.sessionKey,
        parentKey: dto.parentKey,
        label: dto.label,
        taskDescription: dto.taskDescription,
      },
    });
  }

  async getByKey(sessionKey: string) {
    const session = await this.prisma.agentSession.findUnique({
      where: { sessionKey },
    });
    if (!session)
      throw new NotFoundException(`Agent session '${sessionKey}' not found`);
    return session;
  }

  async findByKey(sessionKey: string) {
    return this.prisma.agentSession.findUnique({
      where: { sessionKey },
    });
  }

  async updateStatus(sessionKey: string, dto: UpdateAgentSessionDto) {
    const session = await this.getByKey(sessionKey);
    return this.prisma.agentSession.update({
      where: { id: session.id },
      data: {
        ...dto,
        endedAt:
          dto.status === AgentSessionStatus.COMPLETED ||
          dto.status === AgentSessionStatus.TERMINATED
            ? new Date()
            : undefined,
      },
    });
  }

  async listByParent(parentKey: string) {
    return this.prisma.agentSession.findMany({
      where: { parentKey },
      orderBy: { createdAt: 'desc' },
    });
  }

  async list(options?: { status?: AgentSessionStatus; limit?: number }) {
    return this.prisma.agentSession.findMany({
      where: options?.status ? { status: options.status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: options?.limit ?? 50,
    });
  }
}
