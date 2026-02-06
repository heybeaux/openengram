/**
 * Ensemble Module
 * 
 * Multi-model embedding and RRF fusion for improved memory retrieval.
 * 
 * Enable with ENSEMBLE_ENABLED=true environment variable.
 */

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EnsembleService } from './ensemble.service';
import { EnsembleController } from './ensemble.controller';

@Module({
  imports: [ConfigModule],
  controllers: [EnsembleController],
  providers: [EnsembleService],
  exports: [EnsembleService],
})
export class EnsembleModule {}
