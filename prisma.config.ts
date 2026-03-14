import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: './prisma/schema.prisma',
  migrations: {
    path: './prisma/migrations',
  },
  // datasource.url intentionally omitted: Prisma v7's env() throws at build time
  // when DATABASE_URL is not present (Docker build stage has no env vars).
  // The schema.prisma datasource already reads env("DATABASE_URL") at runtime.
});
