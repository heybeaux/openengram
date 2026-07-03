import { InternalOnlyGuard } from './internal-only.guard';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

describe('InternalOnlyGuard', () => {
  let guard: InternalOnlyGuard;
  let configValues: Record<string, string>;

  function makeContext(ip: string): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ ip, connection: { remoteAddress: ip } }),
      }),
    } as any;
  }

  beforeEach(() => {
    configValues = {
      NODE_ENV: 'development',
      TRUST_LOCAL_NETWORK: 'true',
    };
    const config = {
      get: (key: string, def?: string) => configValues[key] ?? def,
    } as ConfigService;
    guard = new InternalOnlyGuard(config);
  });

  it('should allow local IP in development with TRUST_LOCAL_NETWORK=true', () => {
    expect(guard.canActivate(makeContext('127.0.0.1'))).toBe(true);
  });

  it('should allow ::1', () => {
    expect(guard.canActivate(makeContext('::1'))).toBe(true);
  });

  it('should allow 192.168.x.x', () => {
    expect(guard.canActivate(makeContext('192.168.1.50'))).toBe(true);
  });

  it('should allow 10.x.x.x', () => {
    expect(guard.canActivate(makeContext('10.0.0.5'))).toBe(true);
  });

  it('should allow 172.16-31.x.x', () => {
    expect(guard.canActivate(makeContext('172.16.0.1'))).toBe(true);
    expect(guard.canActivate(makeContext('172.31.255.255'))).toBe(true);
  });

  it('should reject 172.15.x.x (not private)', () => {
    expect(() => guard.canActivate(makeContext('172.15.0.1'))).toThrow(
      ForbiddenException,
    );
  });

  it('should reject 172.32.x.x (not private)', () => {
    expect(() => guard.canActivate(makeContext('172.32.0.1'))).toThrow(
      ForbiddenException,
    );
  });

  it('should reject public IP even with TRUST_LOCAL_NETWORK=true', () => {
    expect(() => guard.canActivate(makeContext('8.8.8.8'))).toThrow(
      ForbiddenException,
    );
  });

  it('should ALWAYS reject in production regardless of TRUST_LOCAL_NETWORK', () => {
    configValues.NODE_ENV = 'production';
    expect(() => guard.canActivate(makeContext('127.0.0.1'))).toThrow(
      ForbiddenException,
    );
  });

  it('should reject when TRUST_LOCAL_NETWORK=false', () => {
    configValues.TRUST_LOCAL_NETWORK = 'false';
    expect(() => guard.canActivate(makeContext('127.0.0.1'))).toThrow(
      ForbiddenException,
    );
  });

  it('should allow ::ffff:192.168.1.1', () => {
    expect(guard.canActivate(makeContext('::ffff:192.168.1.1'))).toBe(true);
  });

  it('should allow ::ffff:172.20.0.1', () => {
    expect(guard.canActivate(makeContext('::ffff:172.20.0.1'))).toBe(true);
  });
});
