import { AccountController } from './account.controller';
import { AccountService } from './account.service';

describe('AccountController', () => {
  let controller: AccountController;
  let accountService: jest.Mocked<AccountService>;

  beforeEach(() => {
    accountService = {
      getSetupStatus: jest.fn(),
      register: jest.fn(),
      login: jest.fn(),
      forgotPassword: jest.fn(),
      resetPassword: jest.fn(),
      getAccount: jest.fn(),
      listApiKeys: jest.fn(),
      changePassword: jest.fn(),
      deleteAccount: jest.fn(),
      createApiKey: jest.fn(),
      deleteApiKey: jest.fn(),
      updateAccount: jest.fn(),
    } as any;
    const prisma = {} as any;
    controller = new AccountController(accountService, prisma);
  });

  describe('getSetupStatus', () => {
    it('should return setup status', async () => {
      accountService.getSetupStatus.mockResolvedValue({ needsSetup: true });
      expect(await controller.getSetupStatus()).toEqual({ needsSetup: true });
    });
  });

  describe('register', () => {
    it('should call register with correct params', async () => {
      const dto = {
        email: 'a@b.com',
        password: '12345678',
        name: 'Test',
        plan: 'FREE',
        accessCode: undefined,
      };
      accountService.register.mockResolvedValue({ token: 'jwt' } as any);
      const result = await controller.register(dto as any);
      expect(accountService.register).toHaveBeenCalledWith(
        'a@b.com',
        '12345678',
        'Test',
        'FREE',
        undefined,
      );
      expect(result).toEqual({ token: 'jwt' });
    });
  });

  describe('login', () => {
    it('should call login with email and password', async () => {
      accountService.login.mockResolvedValue({ token: 'jwt' } as any);
      const result = await controller.login({
        email: 'a@b.com',
        password: 'pass',
      } as any);
      expect(accountService.login).toHaveBeenCalledWith('a@b.com', 'pass');
      expect(result).toEqual({ token: 'jwt' });
    });
  });

  describe('forgotPassword', () => {
    it('should call forgotPassword', async () => {
      accountService.forgotPassword.mockResolvedValue({ sent: true } as any);
      await controller.forgotPassword({ email: 'a@b.com' } as any);
      expect(accountService.forgotPassword).toHaveBeenCalledWith('a@b.com');
    });
  });

  describe('resetPassword', () => {
    it('should call resetPassword with token and new password', async () => {
      accountService.resetPassword.mockResolvedValue({ ok: true } as any);
      await controller.resetPassword({
        token: 'tok',
        newPassword: 'newpass88',
      } as any);
      expect(accountService.resetPassword).toHaveBeenCalledWith(
        'tok',
        'newpass88',
      );
    });
  });

  describe('getAccount', () => {
    it('should pass accountId from request', async () => {
      accountService.getAccount.mockResolvedValue({ id: '123' } as any);
      const result = await controller.getAccount({ accountId: '123' });
      expect(accountService.getAccount).toHaveBeenCalledWith('123');
      expect(result).toEqual({ id: '123' });
    });
  });

  describe('listApiKeys', () => {
    it('should list api keys for account', async () => {
      accountService.listApiKeys.mockResolvedValue([{ id: 'key1' }] as any);
      const result = await controller.listApiKeys({ accountId: '123' });
      expect(accountService.listApiKeys).toHaveBeenCalledWith('123');
      expect(result).toEqual([{ id: 'key1' }]);
    });
  });

  describe('changePassword', () => {
    it('should call changePassword with correct params', async () => {
      accountService.changePassword.mockResolvedValue(undefined as any);
      await controller.changePassword({ accountId: '123' }, {
        currentPassword: 'old',
        newPassword: 'newpass88',
      } as any);
      expect(accountService.changePassword).toHaveBeenCalledWith(
        '123',
        'old',
        'newpass88',
      );
    });
  });

  describe('deleteAccount', () => {
    it('should delete the account', async () => {
      accountService.deleteAccount.mockResolvedValue(undefined as any);
      await controller.deleteAccount({ accountId: '123' });
      expect(accountService.deleteAccount).toHaveBeenCalledWith('123');
    });
  });

  describe('createApiKey', () => {
    it('should create api key with name', async () => {
      accountService.createApiKey.mockResolvedValue({
        key: 'engram_xxx',
      } as any);
      const result = await controller.createApiKey(
        { accountId: '123' },
        { name: 'my-agent' },
      );
      expect(accountService.createApiKey).toHaveBeenCalledWith(
        '123',
        'my-agent',
      );
      expect(result).toEqual({ key: 'engram_xxx' });
    });

    it('should create api key without name', async () => {
      accountService.createApiKey.mockResolvedValue({
        key: 'engram_xxx',
      } as any);
      await controller.createApiKey({ accountId: '123' }, {});
      expect(accountService.createApiKey).toHaveBeenCalledWith(
        '123',
        undefined,
      );
    });
  });

  describe('deleteApiKey', () => {
    it('should delete api key by id', async () => {
      accountService.deleteApiKey.mockResolvedValue(undefined as any);
      await controller.deleteApiKey({ accountId: '123' }, 'key-id');
      expect(accountService.deleteApiKey).toHaveBeenCalledWith('123', 'key-id');
    });
  });

  describe('updateAccount', () => {
    it('should update account with body', async () => {
      accountService.updateAccount.mockResolvedValue({ name: 'New' } as any);
      const result = await controller.updateAccount({ accountId: '123' }, {
        name: 'New',
      } as any);
      expect(accountService.updateAccount).toHaveBeenCalledWith('123', {
        name: 'New',
      });
      expect(result).toEqual({ name: 'New' });
    });
  });
});
