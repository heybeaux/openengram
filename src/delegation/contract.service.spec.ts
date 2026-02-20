import { Test, TestingModule } from '@nestjs/testing';
import { ContractService } from './contract.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('ContractService', () => {
  let service: ContractService;
  let prisma: any;

  const mockContract = {
    id: 'contract-1',
    userId: 'user-1',
    delegator: 'agent-a',
    delegate: 'agent-b',
    taskDescription: 'Deploy v2',
    status: "PROPOSED",
    terms: { deadline: '2026-03-01', qualityCriteria: ['no regressions'] },
    result: null,
    verifiedAt: null,
    completedAt: null,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    tasks: [],
  };

  beforeEach(async () => {
    prisma = {
      delegationContract: {
        create: jest.fn().mockResolvedValue(mockContract),
        findMany: jest.fn().mockResolvedValue([mockContract]),
        findFirst: jest.fn().mockResolvedValue(mockContract),
        update: jest.fn().mockImplementation(({ data }) => ({
          ...mockContract,
          ...data,
        })),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<ContractService>(ContractService);
  });

  describe('create', () => {
    it('should create a contract in PROPOSED state', async () => {
      const result = await service.create('user-1', {
        delegator: 'agent-a',
        delegate: 'agent-b',
        taskDescription: 'Deploy v2',
        terms: { deadline: '2026-03-01' },
      });
      expect(result.status).toBe("PROPOSED");
    });
  });

  describe('update - state transitions', () => {
    it('should allow PROPOSED → ACCEPTED', async () => {
      await service.update('user-1', 'contract-1', {
        status: "ACCEPTED",
      });
      expect(prisma.delegationContract.update).toHaveBeenCalled();
    });

    it('should reject invalid transition PROPOSED → COMPLETED', async () => {
      await expect(
        service.update('user-1', 'contract-1', {
          status: "COMPLETED",
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should allow PROPOSED → REJECTED', async () => {
      await service.update('user-1', 'contract-1', {
        status: "REJECTED",
      });
      expect(prisma.delegationContract.update).toHaveBeenCalled();
    });

    it('should set completedAt on COMPLETED', async () => {
      prisma.delegationContract.findFirst.mockResolvedValue({
        ...mockContract,
        status: "IN_PROGRESS",
      });
      await service.update('user-1', 'contract-1', {
        status: "COMPLETED",
      });
      expect(prisma.delegationContract.update).toHaveBeenCalledWith({
        where: { id: 'contract-1' },
        data: expect.objectContaining({
          completedAt: expect.any(Date),
        }),
      });
    });

    it('should throw if not found', async () => {
      prisma.delegationContract.findFirst.mockResolvedValue(null);
      await expect(
        service.update('user-1', 'nope', { status: "ACCEPTED" }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
