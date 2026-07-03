/**
 * Ingestion Service
 * Orchestrates: discover → parse → chunk → embed → store
 * Handles re-ingestion with checksum comparison
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  Language,
  ChunkType,
  DiscoveredFile,
  RawChunk,
  ProcessedChunk,
  ChunkWithEmbedding,
  IngestStats,
  IngestError,
  ProjectConfig,
} from './types';
import { discoverFiles, DiscoveryResult } from './discovery.service';
import { processChunks, extractFileHeader, computeChecksum } from './chunker.service';
import { generateEmbeddings, checkEmbeddingService } from './embeddings.service';

// Simple regex parsers for MVP - can be replaced with tree-sitter later

const FILE_BATCH_SIZE = 20;

export interface IngestOptions {
  projectConfig: ProjectConfig;
  existingChecksums?: Map<string, string>; // filePath -> checksum for re-ingestion
  onProgress?: (phase: string, current: number, total: number) => void;
  skipEmbeddings?: boolean; // For testing without embedding service
  models?: ('bge-base' | 'nomic' | 'gte-base' | 'minilm')[]; // Embedding models to use
  onBatch?: (chunks: ChunkWithEmbedding[]) => Promise<void>; // Stream batches to caller (enables GC between batches)
}

export interface IngestResult {
  stats: IngestStats;
  chunks: ChunkWithEmbedding[];
  discovery: DiscoveryResult;
}

/**
 * Main ingestion function - orchestrates the full pipeline
 */
export async function ingest(options: IngestOptions): Promise<IngestResult> {
  const startTime = Date.now();
  const { projectConfig, existingChecksums = new Map(), onProgress, skipEmbeddings, models, onBatch } = options;
  const errors: IngestError[] = [];

  let filesProcessed = 0;
  let filesSkipped = 0;
  let chunksCreated = 0;
  let chunksUpdated = 0;
  const chunksDeleted = 0;

  // Phase 1: Discovery
  onProgress?.('discovery', 0, 1);
  let discovery: DiscoveryResult;
  try {
    discovery = await discoverFiles({
      rootPath: projectConfig.rootPath,
      languages: projectConfig.languages,
      customIgnore: projectConfig.ignorePatterns,
    });
    onProgress?.('discovery', 1, 1);
  } catch (error) {
    throw new Error(`Discovery failed: ${error instanceof Error ? error.message : error}`);
  }

  // Check embedding service if we need embeddings
  if (!skipEmbeddings) {
    const embedCheck = await checkEmbeddingService();
    if (!embedCheck.available) {
      throw new Error(`Embedding service unavailable: ${embedCheck.error}`);
    }
  }

  // Phase 2, 3 & 4: Parse, Chunk, and Embed in file batches to limit memory usage
  const allChunksWithEmbeddings: ChunkWithEmbedding[] = [];
  const totalFiles = discovery.files.length;

  for (let batchStart = 0; batchStart < discovery.files.length; batchStart += FILE_BATCH_SIZE) {
    const fileBatch = discovery.files.slice(batchStart, batchStart + FILE_BATCH_SIZE);
    const batchProcessedChunks: ProcessedChunk[] = [];

    // Parse & chunk this batch of files
    for (let j = 0; j < fileBatch.length; j++) {
      const file = fileBatch[j];
      const globalIndex = batchStart + j;
      onProgress?.('parsing', globalIndex + 1, totalFiles);

      try {
        // Read file content
        const content = await fs.promises.readFile(file.absolutePath, 'utf-8');
        const fileChecksum = computeChecksum(content);

        // Check if file changed (for re-ingestion)
        const existingChecksum = existingChecksums.get(file.relativePath);
        if (existingChecksum === fileChecksum) {
          filesSkipped++;
          continue;
        }

        // Parse file into raw chunks
        const rawChunks = parseFile(content, file.language, file.relativePath);

        // Add file header if we have other chunks
        if (rawChunks.length > 0) {
          const firstChunkLine = Math.min(...rawChunks.map((c) => c.lineStart));
          const header = extractFileHeader(content, firstChunkLine);
          if (header) {
            rawChunks.unshift(header);
          }
        }

        // Process chunks (add metadata, checksums, embedding text)
        const processed = processChunks(rawChunks, {
          filePath: file.relativePath,
          language: file.language,
          fileContent: content,
        });

        batchProcessedChunks.push(...processed);
        filesProcessed++;
        chunksCreated += processed.length;

        // Track updated vs new
        if (existingChecksum) {
          chunksUpdated += processed.length;
          chunksCreated -= processed.length;
        }
      } catch (error) {
        errors.push({
          file: file.relativePath,
          error: error instanceof Error ? error.message : String(error),
          phase: 'parse',
        });
      }
    }

    // Embed this batch
    if (batchProcessedChunks.length === 0) continue;

    let batchEmbedded: ChunkWithEmbedding[];
    if (!skipEmbeddings) {
      try {
        batchEmbedded = await generateEmbeddings(batchProcessedChunks, {
          models,
          onProgress: (completed, total) => {
            onProgress?.('embedding', completed, total);
          },
        });
      } catch (error) {
        errors.push({
          file: 'embedding-batch',
          error: error instanceof Error ? error.message : String(error),
          phase: 'embed',
        });
        continue;
      }
    } else {
      batchEmbedded = batchProcessedChunks.map((chunk) => ({
        ...chunk,
        embedding: [],
      }));
    }

    // If onBatch callback provided, stream chunks out and let them be GC'd
    if (onBatch) {
      await onBatch(batchEmbedded);
    } else {
      allChunksWithEmbeddings.push(...batchEmbedded);
    }
  }

  const chunksWithEmbeddings = onBatch ? [] : allChunksWithEmbeddings;

  const duration = Date.now() - startTime;

  return {
    stats: {
      filesProcessed,
      filesSkipped,
      chunksCreated,
      chunksUpdated,
      chunksDeleted,
      errors,
      duration,
    },
    chunks: chunksWithEmbeddings,
    discovery,
  };
}

/**
 * Parse a file into raw chunks based on language
 */
function parseFile(content: string, language: Language, filePath: string): RawChunk[] {
  switch (language) {
    case Language.APEX:
      return parseApex(content, filePath);
    case Language.LWC:
    case Language.JAVASCRIPT:
      return parseJavaScript(content, filePath, language);
    case Language.TYPESCRIPT:
      return parseTypeScript(content, filePath);
    case Language.HTML:
    case Language.CSS:
    case Language.XML:
      // For markup/styles, treat whole file as single chunk
      return parseMarkup(content, filePath, language);
    default:
      return [];
  }
}

/**
 * Parse Apex class/trigger file
 */
function parseApex(content: string, filePath: string): RawChunk[] {
  const chunks: RawChunk[] = [];
  const lines = content.split('\n');

  // Detect if this is a test class
  const isTestClass = /@isTest/i.test(content) || /testMethod/i.test(content);

  // Class/Trigger declaration regex
  const classRegex =
    /(public|private|global)?\s*(virtual|abstract|with sharing|without sharing)?\s*(class|interface|trigger)\s+(\w+)/gi;

  // Method declaration regex
  const methodRegex =
    /(public|private|protected|global)?\s*(static)?\s*(testMethod\s+)?(\w+)\s+(\w+)\s*\([^)]*\)\s*\{/gi;

  let currentClass: string | null = null;
  let classMatch;

  // Find class declaration
  while ((classMatch = classRegex.exec(content)) !== null) {
    currentClass = classMatch[4];
    const lineNum = content.substring(0, classMatch.index).split('\n').length;

    // Find class end (matching brace)
    const classEnd = findMatchingBrace(content, classMatch.index);
    const endLine = content.substring(0, classEnd).split('\n').length;

    const isInterface = classMatch[3].toLowerCase() === 'interface';
    const isTrigger = classMatch[3].toLowerCase() === 'trigger';

    chunks.push({
      content: content.substring(classMatch.index, classEnd + 1),
      lineStart: lineNum,
      lineEnd: endLine,
      chunkType: isTrigger
        ? ChunkType.TRIGGER
        : isInterface
          ? ChunkType.INTERFACE
          : isTestClass
            ? ChunkType.TEST
            : ChunkType.CLASS,
      name: currentClass!,
    });
  }

  // Find methods within the class
  let methodMatch;
  while ((methodMatch = methodRegex.exec(content)) !== null) {
    const methodName = methodMatch[5];
    const lineNum = content.substring(0, methodMatch.index).split('\n').length;

    // Find method end
    const braceStart = content.indexOf('{', methodMatch.index);
    const methodEnd = findMatchingBrace(content, braceStart);
    const endLine = content.substring(0, methodEnd).split('\n').length;

    // Get method content including any preceding annotations
    let methodStart = methodMatch.index;
    const prevLines = content.substring(0, methodStart).split('\n');
    let annotationLine = prevLines.length - 1;
    while (annotationLine >= 0 && prevLines[annotationLine].trim().startsWith('@')) {
      annotationLine--;
    }
    if (annotationLine < prevLines.length - 1) {
      methodStart = prevLines.slice(0, annotationLine + 1).join('\n').length + 1;
    }

    chunks.push({
      content: content.substring(methodStart, methodEnd + 1),
      lineStart: lineNum,
      lineEnd: endLine,
      chunkType: ChunkType.METHOD,
      name: methodName,
      parentName: currentClass || undefined,
    });
  }

  return chunks;
}

/**
 * Parse JavaScript/LWC file
 */
function parseJavaScript(content: string, filePath: string, language: Language): RawChunk[] {
  const chunks: RawChunk[] = [];
  const lines = content.split('\n');

  // LWC component class
  const lwcClassRegex = /export\s+default\s+class\s+(\w+)\s+extends\s+LightningElement/g;

  // Regular class
  const classRegex = /(?:export\s+)?class\s+(\w+)/g;

  // Function declarations
  const funcRegex = /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g;

  // Arrow function assignments
  const arrowRegex = /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>/g;

  let match;

  // Find LWC components
  while ((match = lwcClassRegex.exec(content)) !== null) {
    const lineNum = content.substring(0, match.index).split('\n').length;
    const classEnd = findMatchingBrace(content, content.indexOf('{', match.index));
    const endLine = content.substring(0, classEnd).split('\n').length;

    chunks.push({
      content: content.substring(match.index, classEnd + 1),
      lineStart: lineNum,
      lineEnd: endLine,
      chunkType: ChunkType.COMPONENT,
      name: match[1],
    });
  }

  // Find regular classes (if not LWC)
  if (chunks.length === 0) {
    while ((match = classRegex.exec(content)) !== null) {
      const lineNum = content.substring(0, match.index).split('\n').length;
      const classEnd = findMatchingBrace(content, content.indexOf('{', match.index));
      const endLine = content.substring(0, classEnd).split('\n').length;

      chunks.push({
        content: content.substring(match.index, classEnd + 1),
        lineStart: lineNum,
        lineEnd: endLine,
        chunkType: ChunkType.CLASS,
        name: match[1],
      });
    }
  }

  // Find functions
  while ((match = funcRegex.exec(content)) !== null) {
    const lineNum = content.substring(0, match.index).split('\n').length;
    const funcEnd = findMatchingBrace(content, content.indexOf('{', match.index));
    const endLine = content.substring(0, funcEnd).split('\n').length;

    chunks.push({
      content: content.substring(match.index, funcEnd + 1),
      lineStart: lineNum,
      lineEnd: endLine,
      chunkType: ChunkType.FUNCTION,
      name: match[1],
    });
  }

  return chunks;
}

/**
 * Parse TypeScript file (extends JavaScript parsing)
 */
function parseTypeScript(content: string, filePath: string): RawChunk[] {
  // TypeScript parsing is similar to JavaScript for MVP
  return parseJavaScript(content, filePath, Language.TYPESCRIPT);
}

/**
 * Parse markup files (HTML, CSS, XML) - treat as single chunk
 */
function parseMarkup(content: string, filePath: string, language: Language): RawChunk[] {
  const lines = content.split('\n');
  const fileName = path.basename(filePath, path.extname(filePath));

  return [
    {
      content,
      lineStart: 1,
      lineEnd: lines.length,
      chunkType: ChunkType.FILE_HEADER, // Using FILE_HEADER for full-file chunks
      name: fileName,
    },
  ];
}

/**
 * Find matching closing brace
 */
function findMatchingBrace(content: string, openPos: number): number {
  let depth = 0;
  let inString = false;
  let stringChar = '';
  let inComment = false;
  let inLineComment = false;

  for (let i = openPos; i < content.length; i++) {
    const char = content[i];
    const nextChar = content[i + 1];

    // Handle comments
    if (!inString && !inComment && char === '/' && nextChar === '*') {
      inComment = true;
      i++;
      continue;
    }
    if (inComment && char === '*' && nextChar === '/') {
      inComment = false;
      i++;
      continue;
    }
    if (!inString && !inComment && char === '/' && nextChar === '/') {
      inLineComment = true;
      continue;
    }
    if (inLineComment && char === '\n') {
      inLineComment = false;
      continue;
    }

    if (inComment || inLineComment) continue;

    // Handle strings
    if ((char === '"' || char === "'" || char === '`') && content[i - 1] !== '\\') {
      if (!inString) {
        inString = true;
        stringChar = char;
      } else if (char === stringChar) {
        inString = false;
      }
      continue;
    }

    if (inString) continue;

    // Count braces
    if (char === '{') {
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }

  return content.length - 1;
}

/**
 * Format ingestion stats for display
 */
export function formatIngestStats(stats: IngestStats): string {
  const lines = [
    `Ingestion completed in ${(stats.duration / 1000).toFixed(2)}s`,
    '',
    `Files: ${stats.filesProcessed} processed, ${stats.filesSkipped} unchanged`,
    `Chunks: ${stats.chunksCreated} created, ${stats.chunksUpdated} updated`,
    '',
  ];

  if (stats.errors.length > 0) {
    lines.push(`Errors: ${stats.errors.length}`);
    for (const error of stats.errors.slice(0, 5)) {
      lines.push(`  - ${error.file} (${error.phase}): ${error.error}`);
    }
    if (stats.errors.length > 5) {
      lines.push(`  ... and ${stats.errors.length - 5} more`);
    }
  }

  return lines.join('\n');
}
