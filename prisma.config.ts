import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: './prisma/schema.prisma',
  migrations: {
    path: './prisma/migrations',
  },
  // datasource.url is conditionally set: Prisma v7 requires it for `migrate deploy`
  // but the Docker build stage has no DATABASE_URL. Spreading undefined keys is a no-op,
  // so `prisma generate` (build stage) works fine while `migrate deploy` (CI/runtime) gets the URL.
  ...(process.env.DATABASE_URL
    ? { datasource: { url: process.env.DATABASE_URL } }
    : {}),
});
