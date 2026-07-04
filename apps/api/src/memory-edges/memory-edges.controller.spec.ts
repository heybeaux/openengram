import { BadRequestException } from '@nestjs/common';
import { MemoryEdgesController } from './memory-edges.controller';
import { MemoryEdgesService } from './memory-edges.service';

const mockMemoryEdgesService = {
  createEdge: jest.fn(),
  getEdgesForMemory: jest.fn(),
  deleteEdge: jest.fn(),
  findRelated: jest.fn(),
};

const reqWithAgent = { agent: { id: 'agent-1' } };

describe('MemoryEdgesController', () => {
  let controller: MemoryEdgesController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new MemoryEdgesController(
      mockMemoryEdgesService as unknown as MemoryEdgesService,
    );
  });

  describe('createEdge', () => {
    it('delegates edge creation with the authenticated agent id', async () => {
      const dto = {
        sourceId: 'memory-a',
        targetId: 'memory-b',
        edgeType: 'supports',
      };
      const expected = { id: 'edge-1', ...dto };
      mockMemoryEdgesService.createEdge.mockResolvedValue(expected);

      await expect(controller.createEdge(dto, reqWithAgent)).resolves.toEqual(
        expected,
      );
      expect(mockMemoryEdgesService.createEdge).toHaveBeenCalledWith(
        dto,
        'agent-1',
      );
    });
  });

  describe('getEdgesForMemory', () => {
    it('passes direction and edge type query filters to the service', async () => {
      const expected = [{ id: 'edge-1' }];
      mockMemoryEdgesService.getEdgesForMemory.mockResolvedValue(expected);

      await expect(
        controller.getEdgesForMemory(
          'memory-a',
          { direction: 'outgoing', edgeTypes: ['supports', 'caused_by'] },
          reqWithAgent,
        ),
      ).resolves.toEqual(expected);

      expect(mockMemoryEdgesService.getEdgesForMemory).toHaveBeenCalledWith(
        'memory-a',
        'agent-1',
        'outgoing',
        ['supports', 'caused_by'],
      );
    });
  });

  describe('deleteEdge', () => {
    it('deletes the edge scoped to the authenticated agent id', async () => {
      const expected = { id: 'edge-1' };
      mockMemoryEdgesService.deleteEdge.mockResolvedValue(expected);

      await expect(controller.deleteEdge('edge-1', reqWithAgent)).resolves.toBe(
        expected,
      );
      expect(mockMemoryEdgesService.deleteEdge).toHaveBeenCalledWith(
        'edge-1',
        'agent-1',
      );
    });
  });

  describe('findRelated', () => {
    it('uses default depth and edge types when omitted', async () => {
      const expected = [{ memoryId: 'memory-b', depth: 1 }];
      mockMemoryEdgesService.findRelated.mockResolvedValue(expected);

      await expect(
        controller.findRelated({ nodeId: 'memory-a' }, reqWithAgent),
      ).resolves.toEqual(expected);

      expect(mockMemoryEdgesService.findRelated).toHaveBeenCalledWith(
        'memory-a',
        1,
        [],
        'agent-1',
      );
    });

    it('passes explicit depth and edge type filters to the service', async () => {
      const expected = [{ memoryId: 'memory-c', depth: 2 }];
      mockMemoryEdgesService.findRelated.mockResolvedValue(expected);

      await expect(
        controller.findRelated(
          { nodeId: 'memory-a', depth: 2, edgeTypes: ['supports'] },
          reqWithAgent,
        ),
      ).resolves.toEqual(expected);

      expect(mockMemoryEdgesService.findRelated).toHaveBeenCalledWith(
        'memory-a',
        2,
        ['supports'],
        'agent-1',
      );
    });
  });

  it('throws when the request has no agent context', async () => {
    await expect(
      controller.deleteEdge('edge-1', { agent: undefined }),
    ).rejects.toThrow(BadRequestException);
    expect(mockMemoryEdgesService.deleteEdge).not.toHaveBeenCalled();
  });
});
