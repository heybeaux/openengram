import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProjectDto } from './dto/create-project.dto';
import * as path from 'path';
import * as fs from 'fs';

@Injectable()
export class ProjectsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateProjectDto) {
    // Normalize and validate the root path
    const normalizedPath = path.resolve(dto.rootPath);
    
    // Ensure path doesn't contain traversal sequences after normalization
    if (normalizedPath !== dto.rootPath || dto.rootPath.includes('..')) {
      throw new BadRequestException('Invalid rootPath: path traversal not allowed');
    }

    // Verify the path exists and is a directory
    if (!fs.existsSync(normalizedPath)) {
      throw new BadRequestException(`rootPath does not exist: ${normalizedPath}`);
    }
    
    const stats = fs.statSync(normalizedPath);
    if (!stats.isDirectory()) {
      throw new BadRequestException(`rootPath is not a directory: ${normalizedPath}`);
    }

    // Check if project with same name exists
    const existing = await this.prisma.project.findUnique({
      where: { name: dto.name },
    });

    if (existing) {
      throw new ConflictException(`Project "${dto.name}" already exists`);
    }

    return this.prisma.project.create({
      data: {
        name: dto.name,
        rootPath: normalizedPath,
        languages: dto.languages,
      },
    });
  }

  async findAll() {
    return this.prisma.project.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const project = await this.prisma.project.findUnique({
      where: { id },
    });

    if (!project) {
      throw new NotFoundException(`Project with ID "${id}" not found`);
    }

    return project;
  }

  async remove(id: string) {
    // This will cascade delete all chunks due to onDelete: Cascade in schema
    try {
      return await this.prisma.project.delete({
        where: { id },
      });
    } catch {
      throw new NotFoundException(`Project with ID "${id}" not found`);
    }
  }

  async getStats(id: string) {
    const project = await this.findOne(id);
    
    const chunkCounts = await this.prisma.codeChunk.groupBy({
      by: ['chunkType'],
      where: { projectId: id },
      _count: true,
    });

    const totalChunks = await this.prisma.codeChunk.count({
      where: { projectId: id },
    });

    const fileCount = await this.prisma.codeChunk.findMany({
      where: { projectId: id },
      select: { filePath: true },
      distinct: ['filePath'],
    });

    return {
      project,
      stats: {
        totalChunks,
        fileCount: fileCount.length,
        byType: chunkCounts.reduce((acc, curr) => {
          acc[curr.chunkType] = curr._count;
          return acc;
        }, {} as Record<string, number>),
      },
    };
  }
}
