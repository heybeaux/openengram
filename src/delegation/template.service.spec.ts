import { Test, TestingModule } from '@nestjs/testing';
import { TemplateService } from './template.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';

describe('TemplateService', () => {
  let service: TemplateService;
  let prisma: any;

  const mockTemplate = {
    id: 'tmpl-1',
    userId: 'user-1',
    name: 'Code Review',
    taskType: 'review',
    requiredCapabilities: ['code_review'],
    defaultInstructions: 'Check for bugs',
    expectedOutputs: 'Review comments',
    typicalDurationMs: 3600000,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    prisma = {
      delegationTemplate: {
        create: jest.fn().mockResolvedValue(mockTemplate),
        findMany: jest.fn().mockResolvedValue([mockTemplate]),
        findFirst: jest.fn().mockResolvedValue(mockTemplate),
        update: jest.fn().mockResolvedValue({ ...mockTemplate, name: 'Updated' }),
        delete: jest.fn().mockResolvedValue(mockTemplate),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TemplateService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<TemplateService>(TemplateService);
  });

  describe('create', () => {
    it('should create a template', async () => {
      const result = await service.create('user-1', {
        name: 'Code Review',
        taskType: 'review',
        requiredCapabilities: ['code_review'],
      });
      expect(result.id).toBe('tmpl-1');
    });
  });

  describe('findAll', () => {
    it('should list templates for user', async () => {
      const result = await service.findAll('user-1');
      expect(result).toHaveLength(1);
    });
  });

  describe('update', () => {
    it('should update a template', async () => {
      const result = await service.update('user-1', 'tmpl-1', { name: 'Updated' });
      expect(result.name).toBe('Updated');
    });

    it('should throw if not found', async () => {
      prisma.delegationTemplate.findFirst.mockResolvedValue(null);
      await expect(
        service.update('user-1', 'nope', { name: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('should delete a template', async () => {
      const result = await service.remove('user-1', 'tmpl-1');
      expect(result.deleted).toBe(true);
    });
  });
});
