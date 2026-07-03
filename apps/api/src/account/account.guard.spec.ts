import { AccountJwtGuard } from './account.guard';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

describe('AccountJwtGuard', () => {
  let guard: AccountJwtGuard;
  let jwtService: jest.Mocked<JwtService>;

  const mockRequest: any = {};
  const mockContext = {
    switchToHttp: () => ({
      getRequest: () => mockRequest,
    }),
  } as ExecutionContext;

  beforeEach(() => {
    jwtService = {
      verify: jest.fn(),
    } as any;
    guard = new AccountJwtGuard(jwtService);
    // Reset request
    delete mockRequest.headers;
    delete mockRequest.accountId;
  });

  // Happy paths
  it('should allow valid Bearer token and set accountId', async () => {
    mockRequest.headers = { authorization: 'Bearer valid-token' };
    jwtService.verify.mockReturnValue({ sub: 'account-123' });

    const result = await guard.canActivate(mockContext);

    expect(result).toBe(true);
    expect(mockRequest.accountId).toBe('account-123');
    expect(jwtService.verify).toHaveBeenCalledWith('valid-token');
  });

  // Missing auth header
  it('should throw UnauthorizedException when no Authorization header', async () => {
    mockRequest.headers = {};

    await expect(guard.canActivate(mockContext)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('should throw UnauthorizedException when Authorization header is undefined', async () => {
    mockRequest.headers = { authorization: undefined };

    await expect(guard.canActivate(mockContext)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  // Wrong auth scheme
  it('should throw UnauthorizedException for Basic auth scheme', async () => {
    mockRequest.headers = { authorization: 'Basic dXNlcjpwYXNz' };

    await expect(guard.canActivate(mockContext)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('should throw UnauthorizedException for token without Bearer prefix', async () => {
    mockRequest.headers = { authorization: 'some-token' };

    await expect(guard.canActivate(mockContext)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  // Invalid/expired token
  it('should throw UnauthorizedException when JWT verify fails', async () => {
    mockRequest.headers = { authorization: 'Bearer expired-token' };
    jwtService.verify.mockImplementation(() => {
      throw new Error('jwt expired');
    });

    await expect(guard.canActivate(mockContext)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  // Edge: empty token after Bearer
  it('should pass empty string to verify when Bearer has no token', async () => {
    mockRequest.headers = { authorization: 'Bearer ' };
    jwtService.verify.mockImplementation(() => {
      throw new Error('invalid token');
    });

    await expect(guard.canActivate(mockContext)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(jwtService.verify).toHaveBeenCalledWith('');
  });

  // Edge: payload without sub
  it('should set accountId to undefined if payload has no sub', async () => {
    mockRequest.headers = { authorization: 'Bearer valid' };
    jwtService.verify.mockReturnValue({ email: 'test@test.com' });

    const result = await guard.canActivate(mockContext);

    expect(result).toBe(true);
    expect(mockRequest.accountId).toBeUndefined();
  });
});
