/**
 * Shared types for engram-code ingestion pipeline
 */

export enum Language {
  APEX = 'apex',
  LWC = 'lwc',
  JAVASCRIPT = 'javascript',
  TYPESCRIPT = 'typescript',
  PYTHON = 'python',
  HTML = 'html',
  CSS = 'css',
  XML = 'xml',
}

export enum ChunkType {
  CLASS = 'class',
  METHOD = 'method',
  FUNCTION = 'function',
  COMPONENT = 'component',
  TRIGGER = 'trigger',
  TEST = 'test',
  INTERFACE = 'interface',
  FILE_HEADER = 'file_header',
}

export interface DiscoveredFile {
  absolutePath: string;
  relativePath: string;
  language: Language;
  extension: string;
}

export interface RawChunk {
  content: string;
  lineStart: number;
  lineEnd: number;
  chunkType: ChunkType;
  name: string;
  parentName?: string;
  dependencies?: string[];
}

export interface ProcessedChunk extends RawChunk {
  filePath: string;
  language: Language;
  checksum: string;
  embeddingText: string;
}

export interface ChunkWithEmbedding extends ProcessedChunk {
  embedding: number[];
}

export type EmbeddingModelId = 'bge-base' | 'nomic' | 'gte-base' | 'minilm';

export interface ChunkWithMultiEmbedding extends ProcessedChunk {
  embedding: number[];
  embeddings: Partial<Record<EmbeddingModelId, number[]>>;
}

export interface IngestStats {
  filesProcessed: number;
  filesSkipped: number;
  chunksCreated: number;
  chunksUpdated: number;
  chunksDeleted: number;
  errors: IngestError[];
  duration: number;
}

export interface IngestError {
  file: string;
  error: string;
  phase: 'discovery' | 'parse' | 'chunk' | 'embed' | 'store';
}

export interface EmbeddingResponse {
  object: string;
  data: Array<{
    object: string;
    embedding: number[];
    index: number;
  }>;
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

export interface ProjectConfig {
  rootPath: string;
  projectId?: string;
  languages?: Language[];
  ignorePatterns?: string[];
}
