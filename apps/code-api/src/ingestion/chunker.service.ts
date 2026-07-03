/**
 * Chunker Service
 * Processes parsed chunks, adds file context, computes checksums
 */

import * as crypto from 'crypto';
import { RawChunk, ProcessedChunk, Language, ChunkType } from './types';

export interface ChunkerOptions {
  filePath: string;
  language: Language;
  fileContent: string;
}

/**
 * Processes raw chunks from parsers into storage-ready chunks
 */
export function processChunks(
  rawChunks: RawChunk[],
  options: ChunkerOptions
): ProcessedChunk[] {
  const { filePath, language, fileContent } = options;
  const fileChecksum = computeChecksum(fileContent);

  return rawChunks.map((chunk) => {
    // Build embedding text: "{chunkType} {name}: {content}"
    const embeddingText = buildEmbeddingText(chunk);

    // Compute chunk-specific checksum (content + position)
    const chunkChecksum = computeChunkChecksum(chunk, filePath);

    return {
      ...chunk,
      filePath,
      language,
      checksum: chunkChecksum,
      embeddingText,
    };
  });
}

/**
 * Build the text used for embedding generation
 * Format: "{chunkType} {name}: {content}"
 */
export function buildEmbeddingText(chunk: RawChunk): string {
  const parts: string[] = [];

  // Add chunk type
  parts.push(formatChunkType(chunk.chunkType));

  // Add parent context if available
  if (chunk.parentName) {
    parts.push(`in ${chunk.parentName}`);
  }

  // Add name
  parts.push(chunk.name);

  // Add content (potentially truncated for very long chunks)
  const content = truncateForEmbedding(chunk.content);

  return `${parts.join(' ')}: ${content}`;
}

/**
 * Format chunk type for embedding text
 */
function formatChunkType(type: ChunkType): string {
  switch (type) {
    case ChunkType.CLASS:
      return 'class';
    case ChunkType.METHOD:
      return 'method';
    case ChunkType.FUNCTION:
      return 'function';
    case ChunkType.COMPONENT:
      return 'LWC component';
    case ChunkType.TRIGGER:
      return 'Apex trigger';
    case ChunkType.TEST:
      return 'test class';
    case ChunkType.INTERFACE:
      return 'interface';
    case ChunkType.FILE_HEADER:
      return 'file header';
    default:
      return type;
  }
}

/**
 * Truncate content for embedding if too long
 * BGE models work best with <512 tokens, so we limit characters
 */
function truncateForEmbedding(content: string, maxChars: number = 4000): string {
  if (content.length <= maxChars) {
    return content;
  }

  // Truncate and add indicator
  return content.substring(0, maxChars - 20) + '\n... [truncated]';
}

/**
 * Compute SHA-256 checksum for a string
 */
export function computeChecksum(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Compute checksum for a chunk (includes position for change detection)
 */
export function computeChunkChecksum(chunk: RawChunk, filePath: string): string {
  const data = JSON.stringify({
    content: chunk.content,
    lineStart: chunk.lineStart,
    lineEnd: chunk.lineEnd,
    name: chunk.name,
    chunkType: chunk.chunkType,
    filePath,
  });
  return computeChecksum(data);
}

/**
 * Extract file header (imports + top comments) from content
 */
export function extractFileHeader(
  content: string,
  firstChunkLine: number = Infinity
): RawChunk | null {
  const lines = content.split('\n');
  let headerEnd = 0;

  // Find where the header ends (before first class/function)
  for (let i = 0; i < lines.length && i < firstChunkLine - 1; i++) {
    const line = lines[i].trim();

    // Skip empty lines, comments, imports
    if (
      line === '' ||
      line.startsWith('//') ||
      line.startsWith('/*') ||
      line.startsWith('*') ||
      line.startsWith('*/') ||
      line.startsWith('import ') ||
      line.startsWith('from ') ||
      line.startsWith('package ') ||
      line.startsWith('@') // annotations
    ) {
      headerEnd = i + 1;
      continue;
    }

    // Stop at first non-header content
    break;
  }

  if (headerEnd === 0) {
    return null;
  }

  const headerContent = lines.slice(0, headerEnd).join('\n').trim();
  if (!headerContent) {
    return null;
  }

  return {
    content: headerContent,
    lineStart: 1,
    lineEnd: headerEnd,
    chunkType: ChunkType.FILE_HEADER,
    name: 'file_header',
    dependencies: extractImports(headerContent),
  };
}

/**
 * Extract import statements from header
 */
function extractImports(header: string): string[] {
  const imports: string[] = [];

  // JavaScript/TypeScript imports
  const jsImportRegex = /import\s+.*?from\s+['"]([^'"]+)['"]/g;
  let match;
  while ((match = jsImportRegex.exec(header)) !== null) {
    imports.push(match[1]);
  }

  // Python imports
  const pyImportRegex = /(?:from\s+(\S+)\s+)?import\s+(\S+)/g;
  while ((match = pyImportRegex.exec(header)) !== null) {
    imports.push(match[1] || match[2]);
  }

  return [...new Set(imports)]; // dedupe
}

/**
 * Compare chunks to detect changes
 */
export function hasChunkChanged(
  newChunk: ProcessedChunk,
  existingChecksum: string
): boolean {
  return newChunk.checksum !== existingChecksum;
}

/**
 * Batch process multiple files' chunks
 */
export function processBatch(
  files: Array<{ rawChunks: RawChunk[]; options: ChunkerOptions }>
): ProcessedChunk[] {
  const allChunks: ProcessedChunk[] = [];

  for (const { rawChunks, options } of files) {
    const processed = processChunks(rawChunks, options);
    allChunks.push(...processed);
  }

  return allChunks;
}
