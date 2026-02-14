import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateFeedbackDto } from './feedback.dto';

@Injectable()
export class FeedbackService {
  constructor(private readonly prisma: PrismaService) {}

  async create(accountId: string, dto: CreateFeedbackDto) {
    return this.prisma.uxFeedback.create({
      data: {
        accountId,
        rating: dto.rating,
        text: dto.text,
        category: dto.category,
        page: dto.page,
      },
    });
  }

  async findByAccount(accountId: string, limit = 50) {
    return this.prisma.uxFeedback.findMany({
      where: { accountId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
