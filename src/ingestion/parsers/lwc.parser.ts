/**
 * LWC Parser for engram-code
 * Parses LWC JavaScript files to extract components, properties, and methods
 */

import { 
  Parser, 
  ParseResult, 
  RawChunk, 
  Language, 
  LwcMetadata,
  ChunkType 
} from './parser.interface';

export class LwcParser implements Parser {
  supportedLanguages: Language[] = ['lwc', 'javascript'];
  supportedExtensions: string[] = ['.js'];

  // Patterns for detecting LWC constructs
  private patterns = {
    // Component class declaration
    componentClass: /export\s+default\s+class\s+(\w+)\s+extends\s+(NavigationMixin\s*\(\s*)?LightningElement\s*\)?/g,
    
    // @api decorator
    apiProperty: /@api\s+(?:get\s+)?(\w+)/g,
    
    // @track decorator
    trackProperty: /@track\s+(\w+)/g,
    
    // @wire decorator with adapter
    wireDecorator: /@wire\s*\(\s*(\w+)(?:\s*,\s*\{([^}]*)\})?\s*\)/g,
    
    // Method declarations (including arrow functions)
    methodDeclaration: /^(\s*)(async\s+)?(\w+)\s*\(([^)]*)\)\s*\{/gm,
    
    // Arrow function properties
    arrowFunction: /^(\s*)(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>/gm,
    
    // Event handlers (methods starting with 'handle')
    eventHandler: /\b(handle\w+)\s*[=(]/g,
    
    // Import statements
    importStatement: /^import\s+(?:\{([^}]+)\}|\*\s+as\s+(\w+)|(\w+))\s+from\s+['"]([^'"]+)['"]/gm,
    
    // Custom event dispatch
    dispatchEvent: /this\.dispatchEvent\s*\(\s*new\s+CustomEvent\s*\(\s*['"](\w+)['"]/g,
    
    // Getter/setter
    getter: /get\s+(\w+)\s*\(\s*\)\s*\{/g,
    setter: /set\s+(\w+)\s*\([^)]*\)\s*\{/g,
    
    // connectedCallback, renderedCallback, etc.
    lifecycleCallback: /\b(connectedCallback|disconnectedCallback|renderedCallback|errorCallback)\s*\(\s*\)/g,
  };

  canParse(filePath: string): boolean {
    // Only parse .js files in lwc folders (not test files)
    const ext = filePath.substring(filePath.lastIndexOf('.')).toLowerCase();
    if (ext !== '.js') return false;
    
    // Check if it's in an lwc folder and not a test file
    const isLwc = filePath.includes('/lwc/') || filePath.includes('\\lwc\\');
    const isTest = filePath.includes('__tests__') || filePath.includes('.test.');
    
    return isLwc && !isTest;
  }

  parse(content: string, filePath: string): ParseResult {
    const chunks: RawChunk[] = [];
    const errors: string[] = [];
    const lines = content.split('\n');

    try {
      // Extract imports first
      const imports = this.extractImports(content);
      
      // Find the main component class
      this.parseComponent(content, lines, chunks, filePath, imports);
      
    } catch (error) {
      errors.push(`Error parsing ${filePath}: ${error}`);
    }

    // Extract file header (imports, comments before class)
    const fileHeader = this.extractFileHeader(content, lines, chunks);

    return {
      filePath,
      language: 'lwc',
      chunks,
      fileHeader,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  private parseComponent(
    content: string, 
    lines: string[], 
    chunks: RawChunk[], 
    filePath: string,
    imports: LwcMetadata['imports']
  ): void {
    // Find the component class
    const classMatch = this.patterns.componentClass.exec(content);
    this.patterns.componentClass.lastIndex = 0;
    
    if (!classMatch) {
      return;
    }

    const componentName = classMatch[1];
    const usesNavigationMixin = !!classMatch[2];
    
    const classLineStart = this.getLineNumber(content, classMatch.index);
    const classLineEnd = this.findMatchingBrace(lines, classLineStart - 1);
    
    const classContent = lines.slice(classLineStart - 1, classLineEnd).join('\n');
    
    // Extract decorators and metadata from the class content
    const apiProperties = this.extractApiProperties(classContent);
    const trackProperties = this.extractTrackProperties(classContent);
    const wireDecorators = this.extractWireDecorators(classContent);
    const eventHandlers = this.extractEventHandlers(classContent);
    const dispatchedEvents = this.extractDispatchedEvents(classContent);
    
    const metadata: LwcMetadata = {
      apiProperties,
      trackProperties,
      wireDecorators,
      eventHandlers,
      imports,
      extendsLightningElement: true,
      dispatchedEvents,
    };

    // Add the component class chunk
    const componentChunk: RawChunk = {
      content: classContent,
      lineStart: classLineStart,
      lineEnd: classLineEnd,
      chunkType: 'component',
      name: componentName,
      language: 'lwc',
      metadata: {
        ...metadata,
        usesNavigationMixin,
      },
    };
    chunks.push(componentChunk);

    // Parse methods within the class
    this.parseMethods(classContent, classLineStart, componentName, chunks);
  }

  private parseMethods(
    classContent: string, 
    classLineStart: number, 
    componentName: string, 
    chunks: RawChunk[]
  ): void {
    const lines = classContent.split('\n');
    
    // Find all method declarations - must be valid identifiers (not keywords)
    const methodPattern = /^(\s*)(?:async\s+)?([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(([^)]*)\)\s*\{/gm;
    let match: RegExpExecArray | null;
    
    // JavaScript reserved words that aren't valid method names
    const reservedWords = new Set([
      'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default',
      'break', 'continue', 'return', 'throw', 'try', 'catch', 'finally',
      'new', 'delete', 'typeof', 'void', 'in', 'instanceof', 'with',
      'function', 'var', 'let', 'const', 'class', 'extends', 'import',
      'export', 'static', 'get', 'set', 'async', 'await', 'yield',
      'true', 'false', 'null', 'undefined', 'this', 'super'
    ]);
    
    while ((match = methodPattern.exec(classContent)) !== null) {
      const methodName = match[2];
      
      // Skip reserved words
      if (reservedWords.has(methodName)) {
        continue;
      }
      
      // Skip constructor and lifecycle hooks for individual chunks
      // They're included in the component chunk
      if (['constructor', 'connectedCallback', 'disconnectedCallback', 
           'renderedCallback', 'errorCallback'].includes(methodName)) {
        continue;
      }
      
      const methodLineStart = this.getLineNumber(classContent, match.index);
      const methodLineEnd = this.findMatchingBrace(lines, methodLineStart - 1);
      
      const methodContent = lines.slice(methodLineStart - 1, methodLineEnd).join('\n');
      
      // Check if this is a handler
      const isEventHandler = methodName.startsWith('handle');
      
      // Check for decorators above the method
      const decorators = this.getDecoratorsForMethod(classContent, match.index);
      
      const metadata: Record<string, any> = {};
      if (isEventHandler) {
        metadata.isEventHandler = true;
      }
      if (decorators.length > 0) {
        metadata.decorators = decorators;
      }

      const chunk: RawChunk = {
        content: methodContent,
        lineStart: classLineStart + methodLineStart - 1,
        lineEnd: classLineStart + methodLineEnd - 1,
        chunkType: 'method',
        name: methodName,
        parentName: componentName,
        language: 'lwc',
        metadata,
      };
      chunks.push(chunk);
    }

    // Also parse arrow function properties
    this.parseArrowFunctions(classContent, classLineStart, componentName, chunks, lines);
  }

  private parseArrowFunctions(
    classContent: string, 
    classLineStart: number, 
    componentName: string, 
    chunks: RawChunk[],
    lines: string[]
  ): void {
    const arrowPattern = /^(\s*)(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/gm;
    let match: RegExpExecArray | null;
    
    while ((match = arrowPattern.exec(classContent)) !== null) {
      const funcName = match[2];
      const funcLineStart = this.getLineNumber(classContent, match.index);
      
      // For arrow functions, find the end (could be single line or block)
      const lineContent = lines[funcLineStart - 1];
      let funcLineEnd: number;
      
      if (lineContent.includes('{')) {
        funcLineEnd = this.findMatchingBrace(lines, funcLineStart - 1);
      } else {
        // Single expression arrow function - ends at semicolon or next line
        funcLineEnd = funcLineStart;
        for (let i = funcLineStart; i < lines.length; i++) {
          if (lines[i].includes(';')) {
            funcLineEnd = i + 1;
            break;
          }
        }
      }
      
      const funcContent = lines.slice(funcLineStart - 1, funcLineEnd).join('\n');
      
      const chunk: RawChunk = {
        content: funcContent,
        lineStart: classLineStart + funcLineStart - 1,
        lineEnd: classLineStart + funcLineEnd - 1,
        chunkType: 'function',
        name: funcName,
        parentName: componentName,
        language: 'lwc',
        metadata: {
          isArrowFunction: true,
          isEventHandler: funcName.startsWith('handle'),
        },
      };
      chunks.push(chunk);
    }
  }

  private extractImports(content: string): LwcMetadata['imports'] {
    const imports: LwcMetadata['imports'] = [];
    let match: RegExpExecArray | null;
    
    const regex = new RegExp(this.patterns.importStatement.source, 'gm');
    
    while ((match = regex.exec(content)) !== null) {
      const namedImports = match[1];
      const namespaceImport = match[2];
      const defaultImport = match[3];
      const modulePath = match[4];
      
      const specifiers: string[] = [];
      
      if (namedImports) {
        specifiers.push(...namedImports.split(',').map(s => s.trim()).filter(Boolean));
      }
      if (namespaceImport) {
        specifiers.push(`* as ${namespaceImport}`);
      }
      if (defaultImport) {
        specifiers.push(defaultImport);
      }
      
      imports.push({
        module: modulePath,
        specifiers,
      });
    }
    
    return imports;
  }

  private extractApiProperties(content: string): string[] {
    const properties: string[] = [];
    let match: RegExpExecArray | null;
    
    const regex = new RegExp(this.patterns.apiProperty.source, 'g');
    
    while ((match = regex.exec(content)) !== null) {
      properties.push(match[1]);
    }
    
    return properties;
  }

  private extractTrackProperties(content: string): string[] {
    const properties: string[] = [];
    let match: RegExpExecArray | null;
    
    const regex = new RegExp(this.patterns.trackProperty.source, 'g');
    
    while ((match = regex.exec(content)) !== null) {
      properties.push(match[1]);
    }
    
    return properties;
  }

  private extractWireDecorators(content: string): LwcMetadata['wireDecorators'] {
    const wires: LwcMetadata['wireDecorators'] = [];
    let match: RegExpExecArray | null;
    
    const regex = new RegExp(this.patterns.wireDecorator.source, 'g');
    
    while ((match = regex.exec(content)) !== null) {
      wires.push({
        adapter: match[1],
        config: match[2]?.trim(),
      });
    }
    
    return wires;
  }

  private extractEventHandlers(content: string): string[] {
    const handlers = new Set<string>();
    let match: RegExpExecArray | null;
    
    const regex = new RegExp(this.patterns.eventHandler.source, 'g');
    
    while ((match = regex.exec(content)) !== null) {
      handlers.add(match[1]);
    }
    
    return Array.from(handlers);
  }

  private extractDispatchedEvents(content: string): string[] {
    const events: string[] = [];
    let match: RegExpExecArray | null;
    
    const regex = new RegExp(this.patterns.dispatchEvent.source, 'g');
    
    while ((match = regex.exec(content)) !== null) {
      events.push(match[1]);
    }
    
    return events;
  }

  private getDecoratorsForMethod(content: string, methodIndex: number): string[] {
    const decorators: string[] = [];
    
    // Look backwards from the method to find decorators
    const beforeMethod = content.substring(0, methodIndex);
    const lines = beforeMethod.split('\n');
    
    // Check the few lines before the method
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 5); i--) {
      const line = lines[i].trim();
      if (line.startsWith('@')) {
        const match = line.match(/@(\w+)/);
        if (match) {
          decorators.unshift(match[1]);
        }
      } else if (line && !line.startsWith('//') && !line.startsWith('*')) {
        break; // Stop if we hit non-decorator, non-comment code
      }
    }
    
    return decorators;
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
      chunkType: 'component', // Use 'component' as there's no 'file_header' in the type
      name: 'file_header',
      language: 'lwc',
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
      
      // Skip string literals to avoid counting braces inside strings
      let inString = false;
      let stringChar = '';
      
      for (let j = 0; j < line.length; j++) {
        const char = line[j];
        const prevChar = j > 0 ? line[j - 1] : '';
        
        // Handle string detection
        if ((char === '"' || char === "'" || char === '`') && prevChar !== '\\') {
          if (!inString) {
            inString = true;
            stringChar = char;
          } else if (char === stringChar) {
            inString = false;
          }
          continue;
        }
        
        if (inString) continue;
        
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
export const lwcParser = new LwcParser();
