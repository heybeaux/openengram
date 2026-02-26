import { RateLimitGuard } from './rate-limit.guard';
import { RateLimitService } from './rate-limit.service';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ExecutionContext, HttpException } from '@nestjs/common';

describe('RateLimitGuard', () => {
  let guard: RateLimitGuard;
  let rateLimitService: jest.Mocked<RateLimitService>;
  let reflector: jest.Mocked<Reflector>;
  let configService: jest.Mocked<ConfigService>;
  let mockRequest: any;
  let mockResponse: any;
  let mockContext: ExecutionContext;

  beforeEach(() => {
    rateLimitService = {
      consume: jest.fn(),
    } as any;

    reflector = {
      getAllAndOverride: jest.fn(),
    } as any;

    configService = {
      get: jest.fn().mockReturnValue('cloud'),
    } as any;

    mockRequest = {
      headers: { 'x-am-api-key': 'test-key' },
      ip: '127.0.0.1',
      route: { path: '/v1/memories' },
    };

    mockResponse = {
      set: jest.fn(),
    };

    mockContext = {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
        getResponse: () => mockResponse,
      }),
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
    } as any;
  });

  function createGuard() {
    guard = new RateLimitGuard(rateLimitService, reflector, configService);
  }

  // Happy path: request allowed
  it('should allow requests within limit', async () => {
    createGuard();
    reflector.getAllAndOverride.mockReturnValue(null);
    rateLimitService.consume.mockResolvedValue({
      allowed: true,
      remaining: 99,
      retryAfterMs: 0,
    });

    await expect(guard.canActivate(mockContext)).resolves.toBe(true);
    expect(mockResponse.set).toHaveBeenCalledWith('X-RateLimit-Limit', '100');
    expect(mockResponse.set).toHaveBeenCalledWith(
      'X-RateLimit-Remaining',
      '99',
    );
  });

  // Rate limit exceeded
  it('should throw 429 when rate limit exceeded', async () => {
    createGuard();
    reflector.getAllAndOverride.mockReturnValue(null);
    rateLimitService.consume.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterMs: 30000,
    });

    await expect(guard.canActivate(mockContext)).rejects.toThrow(HttpException);
    try {
      await guard.canActivate(mockContext);
    } catch (e: any) {
      expect(e.getStatus()).toBe(429);
      expect(mockResponse.set).toHaveBeenCalledWith('Retry-After', '30');
    }
  });

  // Skip decorator
  it('should skip rate limiting when @SkipRateLimit is applied', async () => {
    createGuard();
    reflector.getAllAndOverride.mockReturnValueOnce(true);

    await expect(guard.canActivate(mockContext)).resolves.toBe(true);
    expect(rateLimitService.consume).not.toHaveBeenCalled();
  });

  // Custom route limit via decorator
  it('should use route-specific limit from @RateLimit decorator', async () => {
    createGuard();
    reflector.getAllAndOverride
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(20);
    rateLimitService.consume.mockResolvedValue({
      allowed: true,
      remaining: 19,
      retryAfterMs: 0,
    });

    await guard.canActivate(mockContext);

    expect(rateLimitService.consume).toHaveBeenCalledWith(
      'test-key:/v1/memories',
      20,
      60000,
    );
  });

  // Falls back to IP when no API key
  it('should use IP as identifier when no API key', async () => {
    createGuard();
    delete mockRequest.headers['x-am-api-key'];
    reflector.getAllAndOverride.mockReturnValue(null);
    rateLimitService.consume.mockResolvedValue({
      allowed: true,
      remaining: 99,
      retryAfterMs: 0,
    });

    await guard.canActivate(mockContext);

    expect(rateLimitService.consume).toHaveBeenCalledWith(
      '127.0.0.1:/v1/memories',
      100,
      60000,
    );
  });

  // Falls back to 'unknown' when no API key and no IP
  it('should use "unknown" when no API key or IP', async () => {
    createGuard();
    delete mockRequest.headers['x-am-api-key'];
    mockRequest.ip = undefined;
    mockRequest.connection = undefined;
    reflector.getAllAndOverride.mockReturnValue(null);
    rateLimitService.consume.mockResolvedValue({
      allowed: true,
      remaining: 99,
      retryAfterMs: 0,
    });

    await guard.canActivate(mockContext);

    expect(rateLimitService.consume).toHaveBeenCalledWith(
      'unknown:/v1/memories',
      100,
      60000,
    );
  });

  // Uses request.url when no route.path
  it('should fall back to request.url when route.path is unavailable', async () => {
    createGuard();
    mockRequest.route = undefined;
    mockRequest.url = '/v1/memories/query';
    reflector.getAllAndOverride.mockReturnValue(null);
    rateLimitService.consume.mockResolvedValue({
      allowed: true,
      remaining: 99,
      retryAfterMs: 0,
    });

    await guard.canActivate(mockContext);

    expect(rateLimitService.consume).toHaveBeenCalledWith(
      'test-key:/v1/memories/query',
      100,
      60000,
    );
  });

  // Retry-After header rounds up
  it('should round up Retry-After to nearest second', async () => {
    createGuard();
    reflector.getAllAndOverride.mockReturnValue(null);
    rateLimitService.consume.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterMs: 1500,
    });

    await expect(guard.canActivate(mockContext)).rejects.toThrow(HttpException);
  });

  // Local edition skips rate limiting
  it('should skip rate limiting for local edition', async () => {
    configService.get.mockReturnValue('local');
    createGuard();

    await expect(guard.canActivate(mockContext)).resolves.toBe(true);
    expect(rateLimitService.consume).not.toHaveBeenCalled();
  });
});
