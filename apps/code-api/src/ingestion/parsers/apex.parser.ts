/**
 * Apex Parser for engram-code
 * Parses .cls and .trigger files to extract classes, methods, and metadata
 */

import { 
  Parser, 
  ParseResult, 
  RawChunk, 
  Language, 
  ApexMetadata,
  ChunkType 
} from './parser.interface';

export class ApexParser implements Parser {
  supportedLanguages: Language[] = ['apex'];
  supportedExtensions: string[] = ['.cls', '.trigger'];

  // Patterns for detecting Apex constructs
  private patterns = {
    // Class declaration with optional modifiers and sharing mode
    classDeclaration: /^(\s*)((?:@\w+(?:\([^)]*\))?\s*)*)((?:public|private|global)\s+)?(?:(virtual|abstract)\s+)?(?:(with|without|inherited)\s+sharing\s+)?(?:class|interface)\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w\s,]+))?\s*\{/gm,
    
    // Trigger declaration
    triggerDeclaration: /^(\s*)trigger\s+(\w+)\s+on\s+(\w+)\s*\(([\w\s,]+)\)\s*\{/gm,
    
    // Method declaration with optional annotations
    methodDeclaration: /^(\s*)((?:@\w+(?:\([^)]*\))?\s*)*)((?:public|private|protected|global)\s+)?(?:(static)\s+)?(?:(virtual|abstract|override)\s+)?(\w+(?:<[\w<>,\s]+>)?)\s+(\w+)\s*\(([^)]*)\)\s*\{/gm,
    
    // Annotations
    annotation: /@(\w+)(?:\(([^)]*)\))?/g,
    
    // SOQL query (inline and dynamic)
    soqlQuery: /\[\s*SELECT\s+[\s\S]*?\s+FROM\s+\w+[\s\S]*?\]/gi,
    dynamicSoql: /Database\.query\s*\([^)]+\)/gi,
    
    // DML operations
    dmlOperations: /\b(insert|update|delete|upsert|undelete)\s+/gi,
    
    // Inner class
    innerClass: /^(\s*)((?:@\w+(?:\([^)]*\))?\s*)*)((?:public|private|protected)\s+)?(?:(static)\s+)?(?:(virtual|abstract)\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w\s,]+))?\s*\{/gm,
  };

  canParse(filePath: string): boolean {
    const ext = filePath.substring(filePath.lastIndexOf('.')).toLowerCase();
    return this.supportedExtensions.includes(ext);
  }

  parse(content: string, filePath: string): ParseResult {
    const chunks: RawChunk[] = [];
    const errors: string[] = [];
    const lines = content.split('\n');
    const isTrigger = filePath.endsWith('.trigger');

    try {
      if (isTrigger) {
        this.parseTrigger(content, lines, chunks, filePath);
      } else {
        this.parseClass(content, lines, chunks, filePath);
      }
    } catch (error) {
      errors.push(`Error parsing ${filePath}: ${error}`);
    }

    // Extract file header (imports, comments before first class/trigger)
    const fileHeader = this.extractFileHeader(content, lines, chunks);

    return {
      filePath,
      language: 'apex',
      chunks,
      fileHeader,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  private parseClass(content: string, lines: string[], chunks: RawChunk[], filePath: string): void {
    // Find the main class
    const classMatch = this.patterns.classDeclaration.exec(content);
    this.patterns.classDeclaration.lastIndex = 0;
    
    if (!classMatch) {
      return;
    }

    const className = classMatch[6];
    const annotations = this.extractAnnotations(classMatch[2]);
    const isTest = annotations.some(a => a.toLowerCase() === 'istest') || 
                   className.toLowerCase().includes('test');
    
    const classLineStart = this.getLineNumber(content, classMatch.index);
    const classLineEnd = this.findMatchingBrace(lines, classLineStart - 1);
    
    const classContent = lines.slice(classLineStart - 1, classLineEnd).join('\n');
    
    const metadata: ApexMetadata = {
      accessModifier: (classMatch[3]?.trim() as ApexMetadata['accessModifier']) || 'public',
      isVirtual: classMatch[4] === 'virtual',
      isAbstract: classMatch[4] === 'abstract',
      sharingMode: classMatch[5] ? `${classMatch[5]} sharing` as ApexMetadata['sharingMode'] : undefined,
      annotations,
      isTest,
      extends: classMatch[7],
      implements: classMatch[8]?.split(',').map(i => i.trim()).filter(Boolean),
      soqlQueries: this.extractSoqlQueries(classContent),
      dmlOperations: this.extractDmlOperations(classContent),
    };

    // Add the main class chunk
    const classChunk: RawChunk = {
      content: classContent,
      lineStart: classLineStart,
      lineEnd: classLineEnd,
      chunkType: isTest ? 'test' : 'class',
      name: className,
      language: 'apex',
      metadata,
    };
    chunks.push(classChunk);

    // Parse methods within the class
    this.parseMethods(classContent, classLineStart, className, isTest, chunks);
  }

  private parseTrigger(content: string, lines: string[], chunks: RawChunk[], filePath: string): void {
    const triggerMatch = this.patterns.triggerDeclaration.exec(content);
    this.patterns.triggerDeclaration.lastIndex = 0;
    
    if (!triggerMatch) {
      return;
    }

    const triggerName = triggerMatch[2];
    const sObjectType = triggerMatch[3];
    const events = triggerMatch[4];
    
    const lineStart = this.getLineNumber(content, triggerMatch.index);
    const lineEnd = this.findMatchingBrace(lines, lineStart - 1);
    
    const triggerContent = lines.slice(lineStart - 1, lineEnd).join('\n');
    
    const metadata: ApexMetadata = {
      soqlQueries: this.extractSoqlQueries(triggerContent),
      dmlOperations: this.extractDmlOperations(triggerContent),
    };

    const chunk: RawChunk = {
      content: triggerContent,
      lineStart,
      lineEnd,
      chunkType: 'trigger',
      name: triggerName,
      language: 'apex',
      metadata: {
        ...metadata,
        sObjectType,
        triggerEvents: events.split(',').map(e => e.trim()),
      },
    };
    chunks.push(chunk);
  }

  private parseMethods(
    classContent: string, 
    classLineStart: number, 
    className: string, 
    isTestClass: boolean,
    chunks: RawChunk[]
  ): void {
    const lines = classContent.split('\n');
    let match: RegExpExecArray | null;
    
    // Reset regex
    this.patterns.methodDeclaration.lastIndex = 0;
    
    while ((match = this.patterns.methodDeclaration.exec(classContent)) !== null) {
      const methodAnnotations = this.extractAnnotations(match[2]);
      const accessModifier = match[3]?.trim() as ApexMetadata['accessModifier'];
      const isStatic = match[4] === 'static';
      const returnType = match[6];
      const methodName = match[7];
      const parameters = match[8];
      
      const isTestMethod = isTestClass || 
                           methodAnnotations.some(a => a.toLowerCase() === 'istest') ||
                           methodName.toLowerCase().startsWith('test');
      
      const methodLineStart = this.getLineNumber(classContent, match.index);
      const methodLineEnd = this.findMatchingBrace(lines, methodLineStart - 1);
      
      const methodContent = lines.slice(methodLineStart - 1, methodLineEnd).join('\n');
      
      const metadata: ApexMetadata = {
        accessModifier: accessModifier || 'private',
        isStatic,
        annotations: methodAnnotations,
        isTest: isTestMethod,
        returnType,
        parameters,
        soqlQueries: this.extractSoqlQueries(methodContent),
        dmlOperations: this.extractDmlOperations(methodContent),
      };

      const chunk: RawChunk = {
        content: methodContent,
        lineStart: classLineStart + methodLineStart - 1,
        lineEnd: classLineStart + methodLineEnd - 1,
        chunkType: isTestMethod ? 'test' : 'method',
        name: methodName,
        parentName: className,
        language: 'apex',
        metadata,
      };
      chunks.push(chunk);
    }
  }

  private extractAnnotations(annotationBlock: string): string[] {
    if (!annotationBlock) return [];
    
    const annotations: string[] = [];
    let match: RegExpExecArray | null;
    const regex = new RegExp(this.patterns.annotation.source, 'g');
    
    while ((match = regex.exec(annotationBlock)) !== null) {
      annotations.push(match[1]);
    }
    
    return annotations;
  }

  private extractSoqlQueries(content: string): string[] {
    const queries: string[] = [];
    
    // Inline SOQL
    let match: RegExpExecArray | null;
    const inlineRegex = new RegExp(this.patterns.soqlQuery.source, 'gi');
    while ((match = inlineRegex.exec(content)) !== null) {
      queries.push(match[0].trim());
    }
    
    // Dynamic SOQL (just mark as dynamic)
    const dynamicRegex = new RegExp(this.patterns.dynamicSoql.source, 'gi');
    while ((match = dynamicRegex.exec(content)) !== null) {
      queries.push('[DYNAMIC] ' + match[0].trim());
    }
    
    return queries;
  }

  private extractDmlOperations(content: string): string[] {
    const operations = new Set<string>();
    
    let match: RegExpExecArray | null;
    const regex = new RegExp(this.patterns.dmlOperations.source, 'gi');
    
    while ((match = regex.exec(content)) !== null) {
      operations.add(match[1].toLowerCase());
    }
    
    // Also check for Database methods
    const dbMethods = /Database\.(insert|update|delete|upsert|undelete)/gi;
    while ((match = dbMethods.exec(content)) !== null) {
      operations.add(match[1].toLowerCase());
    }
    
    return Array.from(operations);
  }

  private extractFileHeader(content: string, lines: string[], chunks: RawChunk[]): RawChunk | undefined {
    if (chunks.length === 0) return undefined;
    
    const firstChunkLine = Math.min(...chunks.map(c => c.lineStart));
    if (firstChunkLine <= 1) return undefined;
    
    const headerContent = lines.slice(0, firstChunkLine - 1).join('\n').trim();
    if (!headerContent) return undefined;
    
    return {
      content: headerContent,
      lineStart: 1,
      lineEnd: firstChunkLine - 1,
      chunkType: 'class', // Use 'class' as there's no 'file_header' in the type
      name: 'file_header',
      language: 'apex',
    };
  }

  private getLineNumber(content: string, charIndex: number): number {
    const upToIndex = content.substring(0, charIndex);
    return upToIndex.split('\n').length;
  }

  private findMatchingBrace(lines: string[], startLine: number): number {
    let braceCount = 0;
    let foundFirstBrace = false;
    
    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i];
      
      for (const char of line) {
        if (char === '{') {
          braceCount++;
          foundFirstBrace = true;
        } else if (char === '}') {
          braceCount--;
          if (foundFirstBrace && braceCount === 0) {
            return i + 1; // 1-indexed
          }
        }
      }
    }
    
    return lines.length; // Fallback to end of file
  }
}

// Export singleton instance for convenience
export const apexParser = new ApexParser();
