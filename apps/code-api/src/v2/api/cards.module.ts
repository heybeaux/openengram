/**
 * NestJS module wiring for the v2 API (EC-15 / EC-28 / EC-39b).
 *
 * Phase 1 shipped a single read-only cards controller backed by the
 * filesystem. Phase 2 (EC-28) added the map / search / subsystems endpoints
 * and the shared `CardsFsService` that all four controllers depend on.
 * EC-39b adds the multi-repo `GET /v1/repos` listing and exports
 * `CardsFsService` so the ingest module can resolve per-repo artifact paths.
 */

import { Module } from '@nestjs/common';

import { CardsController } from './cards.controller';
import { MapController } from './map.controller';
import { ReposController } from './repos.controller';
import { SearchConceptController } from './search.controller';
import { SubsystemsController } from './subsystems.controller';
import { CardsFsService } from './services/cards-fs.service';

@Module({
  controllers: [
    CardsController,
    MapController,
    ReposController,
    SearchConceptController,
    SubsystemsController,
  ],
  providers: [CardsFsService],
  exports: [CardsFsService],
})
export class CardsModule {}
