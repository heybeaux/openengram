import { Memory } from '@prisma/client';
import {
  MultiQueryMetadataDto,
  ResultExplanationDto,
} from '../multi-query/dto/multi-query.dto';

export interface MemoryWithExtraction extends Memory {
  extraction?: {
    who: string | null;
    what: string | null;
    when: Date | null;
    whereCtx: string | null;
    why: string | null;
    how: string | null;
    topics: string[];
  } | null;
  chain?: MemoryWithExtraction[];
}

export interface MemoryWithScore extends MemoryWithExtraction {
  score?: number;
}

export interface QueryResult {
  memories: MemoryWithScore[];
  queryTokens: number;
  latencyMs: number;
  multiQuery?: MultiQueryMetadataDto;
  explanations?: Record<string, ResultExplanationDto>;
}

export interface ContextResult {
  context: string;
  tokenCount: number;
  memoriesIncluded: number;
  layers: {
    identity: number;
    project: number;
    session: number;
    agent?: number;
  };
}
