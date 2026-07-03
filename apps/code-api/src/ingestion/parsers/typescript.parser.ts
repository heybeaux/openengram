/**
 * TypeScript/JavaScript Parser for engram-code
 * Parses .ts, .tsx, .js, .jsx files to extract classes, functions, interfaces, types, and exports
 * Uses regex/line-based chunking (no AST dependency)
 */

import {
  Parser,
  ParseResult,
  RawChunk,
  Language,
  ChunkType,
} from './parser.interface';

export interface TypeScriptMetadata {
  /** Whether the export is default */
  isDefault?: boolean;
  /** Whether the function/class is exported */
  isExported?: boolean;
  /** Whether the function is async */
  isAsync?: boolean;
  /** Whether the member is static */
  isStatic?: boolean;
  /** Access modifier */
  accessModifier?: 'public' | 'private' | 'protected';
  /** Decorators found */
  decorators?: string[];
  /** Return type annotation */
  returnType?: string;
  /** Parameters string */
  parameters?: string;
  /** Interfaces implemented */
  implements?: string[];
  /** Parent class extended */
  extends?: string;
  /** Generic type parameters */
  typeParameters?: string;
  /** Whether this is a React component (JSX/TSX) */
  isReactComponent?: boolean;
}

export class TypeScriptParser implements Parser {
  supportedLanguages: Language[] = ['typescript', 'javascript'];
  supportedExtensions: string[] = ['.ts', '.tsx', '.js', '.jsx'];

  canParse(filePath: string): boolean {
    const ext = filePath.substring(filePath.lastIndexOf('.')).toLowerCase();
    return this.supportedExtensions.includes(ext);
  }

  parse(content: string, filePath: string): ParseResult {
    const chunks: RawChunk[] = [];
    const errors: string[] = [];
    const lines = content.split('\n');
    const language: Language = filePath.match(/\.[jt]sx?$/)
      ? (filePath.match(/\.tsx?$/) ? 'typescript' : 'javascript')
      : 'typescript';

    try {
      this.parseTopLevel(content, lines, language, chunks);
    } catch (error) {
      errors.push(`Error parsing ${filePath}: ${error}`);
    }

    const fileHeader = this.extractFileHeader(lines, chunks, language);

    return {
      filePath,
      language,
      chunks,
      fileHeader,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  private parseTopLevel(
    content: string,
    lines: string[],
    language: Language,
    chunks: RawChunk[],
  ): void {
    // Track which lines are already claimed by a chunk to avoid duplicates
    const claimed = new Set<number>();

    // 1. Classes (including exported, abstract, decorated)
    this.parseClasses(content, lines, language, chunks, claimed);

    // 2. Interfaces and type aliases (TS only)
    this.parseInterfaces(content, lines, language, chunks, claimed);

    // 3. Standalone functions (named function declarations, arrow const, export function)
    this.parseFunctions(content, lines, language, chunks, claimed);
  }

  // ─── Classes ──────────────────────────────────────────────────────────

  private parseClasses(
    content: string,
    lines: string[],
    language: Language,
    chunks: RawChunk[],
    claimed: Set<number>,
  ): void {
    // Match: (decorators)? (export (default)?)? (abstract)? class Name (<T>)? (extends X)? (implements Y, Z)?
    const classRe =
      /^((?:\s*@\w+(?:\([^)]*\))?\s*\n)*)(\s*)(export\s+(?:default\s+)?)?(?:abstract\s+)?class\s+(\w+)(?:<([^>]+)>)?(?:\s+extends\s+([\w.]+)(?:<[^>]+>)?)?(?:\s+implements\s+([\w\s,.<>]+))?\s*\{/gm;

    let match: RegExpExecArray | null;
    while ((match = classRe.exec(content)) !== null) {
      const lineStart = this.getLineNumber(content, match.index);
      if (claimed.has(lineStart)) continue;

      const lineEnd = this.findMatchingBrace(lines, lineStart - 1);
      const classContent = lines.slice(lineStart - 1, lineEnd).join('\n');
      const className = match[4];

      const metadata: TypeScriptMetadata = {
        isExported: !!match[3],
        isDefault: match[3]?.includes('default') ?? false,
        decorators: this.extractDecorators(match[1] || ''),
        extends: match[6],
        implements: match[7]?.split(',').map((s) => s.trim()).filter(Boolean),
        typeParameters: match[5],
      };

      chunks.push({
        content: classContent,
        lineStart,
        lineEnd,
        chunkType: 'class' as ChunkType,
        name: className,
        language,
        metadata,
      });

      this.markClaimed(claimed, lineStart, lineEnd);

      // Parse methods inside the class
      this.parseMethods(classContent, lineStart, className, language, chunks);
    }
  }

  private parseMethods(
    classContent: string,
    classLineStart: number,
    className: string,
    language: Language,
    chunks: RawChunk[],
  ): void {
    const lines = classContent.split('\n');

    // Match methods: (decorators)? (access)? (static)? (async)? name(<T>)?(params)(: returnType)? {
    const methodRe =
      /^((?:\s*@\w+(?:\([^)]*\))?\s*\n)*)(\s*)(public|private|protected)?\s*(static\s+)?(async\s+)?(\w+)(?:<([^>]+)>)?\s*\(([^)]*)\)(?:\s*:\s*([^\s{]+(?:<[^>]+>)?))?\s*\{/gm;

    let match: RegExpExecArray | null;
    while ((match = methodRe.exec(classContent)) !== null) {
      const methodName = match[6];
      // Skip the constructor-like class name match and common false positives
      if (methodName === 'if' || methodName === 'for' || methodName === 'while' || methodName === 'switch' || methodName === 'catch') continue;

      const methodLineStart = this.getLineNumber(classContent, match.index);
      const methodLineEnd = this.findMatchingBrace(lines, methodLineStart - 1);
      const methodContent = lines.slice(methodLineStart - 1, methodLineEnd).join('\n');

      const metadata: TypeScriptMetadata = {
        accessModifier: (match[3] as TypeScriptMetadata['accessModifier']) || undefined,
        isStatic: !!match[4],
        isAsync: !!match[5],
        decorators: this.extractDecorators(match[1] || ''),
        parameters: match[8],
        returnType: match[9],
        typeParameters: match[7],
      };

      chunks.push({
        content: methodContent,
        lineStart: classLineStart + methodLineStart - 1,
        lineEnd: classLineStart + methodLineEnd - 1,
        chunkType: 'method' as ChunkType,
        name: methodName,
        parentName: className,
        language,
        metadata,
      });
    }
  }

  // ─── Interfaces & Types ───────────────────────────────────────────────

  private parseInterfaces(
    content: string,
    lines: string[],
    language: Language,
    chunks: RawChunk[],
    claimed: Set<number>,
  ): void {
    // Interfaces
    const ifaceRe =
      /^(\s*)(export\s+)?interface\s+(\w+)(?:<([^>]+)>)?(?:\s+extends\s+([\w\s,.<>]+))?\s*\{/gm;

    let match: RegExpExecArray | null;
    while ((match = ifaceRe.exec(content)) !== null) {
      const lineStart = this.getLineNumber(content, match.index);
      if (claimed.has(lineStart)) continue;

      const lineEnd = this.findMatchingBrace(lines, lineStart - 1);
      const ifContent = lines.slice(lineStart - 1, lineEnd).join('\n');

      const metadata: TypeScriptMetadata = {
        isExported: !!match[2],
        extends: match[5],
        typeParameters: match[4],
      };

      chunks.push({
        content: ifContent,
        lineStart,
        lineEnd,
        chunkType: 'interface' as ChunkType,
        name: match[3],
        language,
        metadata,
      });

      this.markClaimed(claimed, lineStart, lineEnd);
    }

    // Type aliases: export? type Name<T> = ...
    const typeRe =
      /^(\s*)(export\s+)?type\s+(\w+)(?:<([^>]+)>)?\s*=\s*/gm;

    while ((match = typeRe.exec(content)) !== null) {
      const lineStart = this.getLineNumber(content, match.index);
      if (claimed.has(lineStart)) continue;

      // Type aliases end at semicolon or closing brace; find the extent
      let lineEnd = lineStart;
      const startLine = lines[lineStart - 1];
      if (startLine.includes('{')) {
        lineEnd = this.findMatchingBrace(lines, lineStart - 1);
      } else {
        // Scan forward for the terminating semicolon
        for (let i = lineStart - 1; i < lines.length; i++) {
          if (lines[i].includes(';')) {
            lineEnd = i + 1;
            break;
          }
        }
      }

      const typeContent = lines.slice(lineStart - 1, lineEnd).join('\n');

      chunks.push({
        content: typeContent,
        lineStart,
        lineEnd,
        chunkType: 'interface' as ChunkType, // reuse 'interface' for type aliases
        name: match[3],
        language,
        metadata: {
          isExported: !!match[2],
          typeParameters: match[4],
        } as TypeScriptMetadata,
      });

      this.markClaimed(claimed, lineStart, lineEnd);
    }
  }

  // ─── Functions ────────────────────────────────────────────────────────

  private parseFunctions(
    content: string,
    lines: string[],
    language: Language,
    chunks: RawChunk[],
    claimed: Set<number>,
  ): void {
    // Named function declarations: (export (default)?)? (async)? function name(<T>)?(params)(: ret)? {
    const fnDeclRe =
      /^(\s*)(export\s+(?:default\s+)?)?(?:async\s+)?function\s+(\w+)(?:<([^>]+)>)?\s*\(([^)]*)\)(?:\s*:\s*([^\s{]+(?:<[^>]+>)?))?\s*\{/gm;

    let match: RegExpExecArray | null;
    while ((match = fnDeclRe.exec(content)) !== null) {
      const lineStart = this.getLineNumber(content, match.index);
      if (claimed.has(lineStart)) continue;

      const lineEnd = this.findMatchingBrace(lines, lineStart - 1);
      const fnContent = lines.slice(lineStart - 1, lineEnd).join('\n');

      const metadata: TypeScriptMetadata = {
        isExported: !!match[2],
        isDefault: match[2]?.includes('default') ?? false,
        isAsync: content.substring(match.index, match.index + match[0].length).includes('async'),
        parameters: match[5],
        returnType: match[6],
        typeParameters: match[4],
      };

      chunks.push({
        content: fnContent,
        lineStart,
        lineEnd,
        chunkType: 'function' as ChunkType,
        name: match[3],
        language,
        metadata,
      });

      this.markClaimed(claimed, lineStart, lineEnd);
    }

    // Arrow functions assigned to const/let: (export (default)?)? const name = (async)? (<T>)?(params)(: ret)? => {
    const arrowRe =
      /^(\s*)(export\s+(?:default\s+)?)?(?:const|let)\s+(\w+)(?:\s*:\s*[^=]+)?\s*=\s*(async\s+)?(?:<([^>]+)>\s*)?\(([^)]*)\)(?:\s*:\s*([^\s=>]+(?:<[^>]+>)?))?\s*=>\s*\{/gm;

    while ((match = arrowRe.exec(content)) !== null) {
      const lineStart = this.getLineNumber(content, match.index);
      if (claimed.has(lineStart)) continue;

      const lineEnd = this.findMatchingBrace(lines, lineStart - 1);
      const fnContent = lines.slice(lineStart - 1, lineEnd).join('\n');

      const metadata: TypeScriptMetadata = {
        isExported: !!match[2],
        isDefault: match[2]?.includes('default') ?? false,
        isAsync: !!match[4],
        parameters: match[6],
        returnType: match[7],
        typeParameters: match[5],
      };

      chunks.push({
        content: fnContent,
        lineStart,
        lineEnd,
        chunkType: 'function' as ChunkType,
        name: match[3],
        language,
        metadata,
      });

      this.markClaimed(claimed, lineStart, lineEnd);
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

  private extractDecorators(block: string): string[] {
    if (!block.trim()) return [];
    const decorators: string[] = [];
    const re = /@(\w+)(?:\([^)]*\))?/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(block)) !== null) {
      decorators.push(m[1]);
    }
    return decorators;
  }

  private extractFileHeader(
    lines: string[],
    chunks: RawChunk[],
    language: Language,
  ): RawChunk | undefined {
    if (chunks.length === 0) return undefined;
    const firstLine = Math.min(...chunks.map((c) => c.lineStart));
    if (firstLine <= 1) return undefined;
    const headerContent = lines.slice(0, firstLine - 1).join('\n').trim();
    if (!headerContent) return undefined;
    return {
      content: headerContent,
      lineStart: 1,
      lineEnd: firstLine - 1,
      chunkType: 'class' as ChunkType,
      name: 'file_header',
      language,
    };
  }

  private getLineNumber(content: string, charIndex: number): number {
    return content.substring(0, charIndex).split('\n').length;
  }

  private findMatchingBrace(lines: string[], startLine: number): number {
    let braceCount = 0;
    let foundFirst = false;

    for (let i = startLine; i < lines.length; i++) {
      for (const char of lines[i]) {
        if (char === '{') {
          braceCount++;
          foundFirst = true;
        } else if (char === '}') {
          braceCount--;
          if (foundFirst && braceCount === 0) {
            return i + 1; // 1-indexed
          }
        }
      }
    }
    return lines.length;
  }

  private markClaimed(claimed: Set<number>, start: number, end: number): void {
    for (let i = start; i <= end; i++) {
      claimed.add(i);
    }
  }
}

export const typescriptParser = new TypeScriptParser();
