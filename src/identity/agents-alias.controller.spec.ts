import { AgentsAliasController } from './agents-alias.controller';
import { IdentityController } from './identity.controller';

describe('AgentsAliasController', () => {
  let controller: AgentsAliasController;
  let identityController: jest.Mocked<IdentityController>;

  beforeEach(() => {
    identityController = {
      listAgents: jest.fn(),
      getAgent: jest.fn(),
    } as any;
    controller = new AgentsAliasController(identityController);
  });

  describe('listAgents', () => {
    it('should delegate to IdentityController.listAgents', async () => {
      const mockReq = { accountId: 'acc1' };
      const mockResult = { agents: [{ id: '1', name: 'test', apiKeyHint: 'abc', createdAt: new Date(), updatedAt: new Date(), memoryCount: 0, lastActive: null, capabilities: [], trustSummary: null }] };
      identityController.listAgents.mockResolvedValue(mockResult);

      const result = await controller.listAgents(mockReq);

      expect(identityController.listAgents).toHaveBeenCalledWith(mockReq);
      expect(result).toEqual(mockResult);
    });
  });

  describe('getAgent', () => {
    it('should delegate to IdentityController.getAgent', async () => {
      const mockReq = { accountId: 'acc1' };
      const mockResult = { id: 'agent1', name: 'test', apiKeyHint: 'abc', createdAt: new Date(), updatedAt: new Date(), capabilities: [] as any[], trustSummary: null };
      identityController.getAgent.mockResolvedValue(mockResult);

      const result = await controller.getAgent('agent1', mockReq);

      expect(identityController.getAgent).toHaveBeenCalledWith('agent1', mockReq);
      expect(result).toEqual(mockResult);
    });
  });
});
