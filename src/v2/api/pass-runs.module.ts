/**
 * NestJS module wiring for the v2 pass-runs HTTP surface (EC-47).
 *
 * Kept separate from `CardsModule` because the cards/map/search/repos
 * controllers are pure filesystem-backed and their tests boot the module
 * in isolation without a Postgres connection. Adding a Prisma-dependent
 * controller to that module forced every cards-suite test to either
 * provide a fake Prisma or pay the cost of `$connect()` at startup.
 *
 * Splitting `PassRunsModule` out lets:
 *   - app.module.ts mount the controller via the global PrismaModule, and
 *   - the controller spec stand up a tiny Test module with a fake Prisma
 *
 * without touching any other suite.
 */

import { Module } from '@nestjs/common';

import { PassRunsController } from './pass-runs.controller';

@Module({
  controllers: [PassRunsController],
})
export class PassRunsModule {}
