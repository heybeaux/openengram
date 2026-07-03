import { AsyncLocalStorage } from 'async_hooks';
import { PrismaClient } from '@prisma/client';

/**
 * AsyncLocalStorage that holds the transactional Prisma client
 * set by RlsInterceptor. Any code downstream can access it via
 * rlsContext.getStore() to get RLS-filtered queries automatically.
 */
export const rlsContext = new AsyncLocalStorage<PrismaClient>();
