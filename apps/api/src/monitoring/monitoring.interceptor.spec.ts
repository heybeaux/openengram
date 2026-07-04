import { CallHandler, ExecutionContext, HttpException } from '@nestjs/common';
import { lastValueFrom, throwError } from 'rxjs';
import { MonitoringInterceptor } from './monitoring.interceptor';
import { MonitoringService } from './monitoring.service';

function makeContext(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as ExecutionContext;
}

function makeFailingHandler(error: unknown): CallHandler {
  return {
    handle: () => throwError(() => error),
  } as CallHandler;
}

describe('MonitoringInterceptor', () => {
  let monitoring: jest.Mocked<Pick<MonitoringService, 'recordApiError'>>;
  let interceptor: MonitoringInterceptor;

  beforeEach(() => {
    monitoring = { recordApiError: jest.fn() };
    interceptor = new MonitoringInterceptor(monitoring as MonitoringService);
  });

  it('records 5xx HttpException errors with the request URL', async () => {
    const error = new HttpException('upstream exploded', 503);
    const context = makeContext({ url: '/v1/memories?limit=25' });

    await expect(
      lastValueFrom(interceptor.intercept(context, makeFailingHandler(error))),
    ).rejects.toBe(error);

    expect(monitoring.recordApiError).toHaveBeenCalledWith(
      503,
      '/v1/memories?limit=25',
    );
  });

  it('falls back to request.path when request.url is not available', async () => {
    const error = new HttpException('service unavailable', 500);
    const context = makeContext({ path: '/v1/health/metrics' });

    await expect(
      lastValueFrom(interceptor.intercept(context, makeFailingHandler(error))),
    ).rejects.toBe(error);

    expect(monitoring.recordApiError).toHaveBeenCalledWith(
      500,
      '/v1/health/metrics',
    );
  });

  it('uses unknown when neither url nor path is available', async () => {
    const error = new HttpException('internal error', 500);
    const context = makeContext({});

    await expect(
      lastValueFrom(interceptor.intercept(context, makeFailingHandler(error))),
    ).rejects.toBe(error);

    expect(monitoring.recordApiError).toHaveBeenCalledWith(500, 'unknown');
  });

  it('does not record expected 4xx HttpException errors', async () => {
    const error = new HttpException('bad request', 400);
    const context = makeContext({ url: '/v1/memories' });

    await expect(
      lastValueFrom(interceptor.intercept(context, makeFailingHandler(error))),
    ).rejects.toBe(error);

    expect(monitoring.recordApiError).not.toHaveBeenCalled();
  });

  it('records non-HttpException errors as 500 responses', async () => {
    const error = new Error('database disappeared');
    const context = makeContext({ url: '/v1/account' });

    await expect(
      lastValueFrom(interceptor.intercept(context, makeFailingHandler(error))),
    ).rejects.toBe(error);

    expect(monitoring.recordApiError).toHaveBeenCalledWith(500, '/v1/account');
  });
});
