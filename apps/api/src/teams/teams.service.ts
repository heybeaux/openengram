import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateTeamDto,
  UpdateTeamDto,
  AddTeamMemberDto,
  RecordCollaborationDto,
  TeamResponseDto,
  TeamMemberResponseDto,
  CollaborationResponseDto,
} from './dto/team.dto';

@Injectable()
export class TeamsService {
  constructor(private readonly prisma: PrismaService) {}

  // ── CRUD ─────────────────────────────────────────────────────────────

  async create(userId: string, dto: CreateTeamDto): Promise<TeamResponseDto> {
    const team = await this.prisma.agentTeam.create({
      data: {
        name: dto.name,
        description: dto.description,
        sharedCapabilities: dto.sharedCapabilities ?? [],
        userId,
        members: dto.members?.length
          ? {
              create: dto.members.map((m) => ({
                agentId: m.agentId,
                role: m.role,
              })),
            }
          : undefined,
      },
      include: { members: true },
    });

    return this.toResponse(team);
  }

  async findAll(userId: string): Promise<TeamResponseDto[]> {
    const teams = await this.prisma.agentTeam.findMany({
      where: { userId, deletedAt: null },
      include: { members: true },
      orderBy: { createdAt: 'desc' },
    });
    return teams.map((t) => this.toResponse(t));
  }

  async findOne(userId: string, id: string): Promise<TeamResponseDto> {
    const team = await this.prisma.agentTeam.findFirst({
      where: { id, userId, deletedAt: null },
      include: { members: true },
    });
    if (!team) throw new NotFoundException(`Team ${id} not found`);
    return this.toResponse(team);
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateTeamDto,
  ): Promise<TeamResponseDto> {
    await this.ensureTeamExists(userId, id);
    const team = await this.prisma.agentTeam.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        sharedCapabilities: dto.sharedCapabilities,
      },
      include: { members: true },
    });
    return this.toResponse(team);
  }

  async remove(userId: string, id: string): Promise<{ deleted: true }> {
    await this.ensureTeamExists(userId, id);
    await this.prisma.agentTeam.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return { deleted: true };
  }

  // ── Members ──────────────────────────────────────────────────────────

  async addMember(
    userId: string,
    teamId: string,
    dto: AddTeamMemberDto,
  ): Promise<TeamMemberResponseDto> {
    await this.ensureTeamExists(userId, teamId);
    const member = await this.prisma.agentTeamMember.create({
      data: {
        teamId,
        agentId: dto.agentId,
        role: dto.role,
      },
    });
    return this.memberToResponse(member);
  }

  async removeMember(
    userId: string,
    teamId: string,
    memberId: string,
  ): Promise<{ deleted: true }> {
    await this.ensureTeamExists(userId, teamId);
    await this.prisma.agentTeamMember.delete({ where: { id: memberId } });
    return { deleted: true };
  }

  // ── Collaboration History ────────────────────────────────────────────

  async recordCollaboration(
    userId: string,
    teamId: string,
    dto: RecordCollaborationDto,
  ): Promise<CollaborationResponseDto> {
    await this.ensureTeamExists(userId, teamId);

    const collab = await this.prisma.agentTeamCollaboration.create({
      data: {
        teamId,
        taskDescription: dto.taskDescription,
        participantAgentIds: dto.participantAgentIds,
        outcome: dto.outcome,
        score: dto.score,
      },
    });

    // Update team-level trust score and collaboration count
    const allCollabs = await this.prisma.agentTeamCollaboration.findMany({
      where: { teamId },
      select: { score: true },
    });

    const scores = allCollabs
      .map((c) => c.score)
      .filter((s): s is number => s != null);
    const avgScore =
      scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

    await this.prisma.agentTeam.update({
      where: { id: teamId },
      data: {
        trustScore: avgScore,
        collaborationCount: allCollabs.length,
      },
    });

    return {
      id: collab.id,
      teamId: collab.teamId,
      taskDescription: collab.taskDescription,
      participantAgentIds: collab.participantAgentIds,
      outcome: collab.outcome,
      score: collab.score,
      createdAt: collab.createdAt.toISOString(),
    };
  }

  async getCollaborations(
    userId: string,
    teamId: string,
    limit = 50,
  ): Promise<CollaborationResponseDto[]> {
    await this.ensureTeamExists(userId, teamId);
    const collabs = await this.prisma.agentTeamCollaboration.findMany({
      where: { teamId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return collabs.map((c) => ({
      id: c.id,
      teamId: c.teamId,
      taskDescription: c.taskDescription,
      participantAgentIds: c.participantAgentIds,
      outcome: c.outcome,
      score: c.score,
      createdAt: c.createdAt.toISOString(),
    }));
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  private async ensureTeamExists(userId: string, id: string) {
    const team = await this.prisma.agentTeam.findFirst({
      where: { id, userId, deletedAt: null },
    });
    if (!team) throw new NotFoundException(`Team ${id} not found`);
    return team;
  }

  private toResponse(team: any): TeamResponseDto {
    return {
      id: team.id,
      name: team.name,
      description: team.description,
      sharedCapabilities: team.sharedCapabilities ?? [],
      trustScore: team.trustScore ?? 0,
      collaborationCount: team.collaborationCount ?? 0,
      members: (team.members ?? []).map((m: any) => this.memberToResponse(m)),
      createdAt: team.createdAt.toISOString(),
      updatedAt: team.updatedAt.toISOString(),
    };
  }

  private memberToResponse(member: any): TeamMemberResponseDto {
    return {
      id: member.id,
      agentId: member.agentId,
      role: member.role,
      joinedAt: member.joinedAt.toISOString(),
    };
  }
}
