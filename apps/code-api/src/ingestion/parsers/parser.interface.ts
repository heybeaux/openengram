/**
 * Parser interfaces for engram-code
 * Defines the common types and contracts for language-specific parsers
 */

export type ChunkType = 'class' | 'method' | 'function' | 'component' | 'trigger' | 'test' | 'interface';
export type Language = 'apex' | 'lwc' | 'javascript' | 'typescript' | 'python';

/**
 * Raw chunk extracted from source code before embedding
 */
export interface RawChunk {
  /** The actual source code content */
  content: string;
  
  /** 1-indexed line number where chunk starts */
  lineStart: number;
  
  /** 1-indexed line number where chunk ends */
  lineEnd: number;
  
  /** Type of code construct */
  chunkType: ChunkType;
  
  /** Name of the class/method/function/component */
  name: string;
  
  /** Parent class name for methods */
  parentName?: string;
  
  /** Source language */
  language: Language;
  
  /** Language-specific metadata */
  metadata?: Record<string, any>;
}

/**
 * Result of parsing a single file
 */
export interface ParseResult {
  /** Path to the parsed file (relative to project root) */
  filePath: string;
  
  /** Detected language */
  language: Language;
  
  /** Extracted chunks */
  chunks: RawChunk[];
  
  /** File header (imports, comments at top) */
  fileHeader?: RawChunk;
  
  /** Any parsing errors encountered */
  errors?: string[];
}

/**
 * Parser interface for language-specific implementations
 */
export interface Parser {
  /** Languages this parser supports */
  supportedLanguages: Language[];
  
  /** File extensions this parser handles */
  supportedExtensions: string[];
  
  /**
   * Parse a source file and extract chunks
   * @param content - Raw file content
   * @param filePath - Path to the file (for error messages)
   * @returns ParseResult with extracted chunks
   */
  parse(content: string, filePath: string): ParseResult;
  
  /**
   * Check if this parser can handle the given file
   * @param filePath - Path to check
   * @returns true if this parser should handle the file
   */
  canParse(filePath: string): boolean;
}

/**
 * Apex-specific metadata
 */
export interface ApexMetadata {
  /** Sharing mode: 'with sharing', 'without sharing', 'inherited sharing', or undefined */
  sharingMode?: 'with sharing' | 'without sharing' | 'inherited sharing';
  
  /** Access modifier: public, private, global, protected */
  accessModifier?: 'public' | 'private' | 'global' | 'protected';
  
  /** Annotations like @AuraEnabled, @TestVisible, @isTest, @HttpGet, etc. */
  annotations?: string[];
  
  /** Whether the method/class is static */
  isStatic?: boolean;
  
  /** Whether the class is virtual */
  isVirtual?: boolean;
  
  /** Whether the class is abstract */
  isAbstract?: boolean;
  
  /** Whether this is a test class/method */
  isTest?: boolean;
  
  /** SOQL queries found in the chunk */
  soqlQueries?: string[];
  
  /** DML operations found (insert, update, delete, upsert, undelete) */
  dmlOperations?: string[];
  
  /** Return type for methods */
  returnType?: string;
  
  /** Parameter list for methods */
  parameters?: string;
  
  /** Interfaces implemented */
  implements?: string[];
  
  /** Parent class extended */
  extends?: string;
}

/**
 * LWC-specific metadata
 */
export interface LwcMetadata {
  /** @wire decorators with their adapters */
  wireDecorators?: Array<{
    adapter: string;
    config?: string;
  }>;
  
  /** @api properties */
  apiProperties?: string[];
  
  /** @track properties */
  trackProperties?: string[];
  
  /** Event handlers (methods starting with 'handle') */
  eventHandlers?: string[];
  
  /** Imported modules */
  imports?: Array<{
    module: string;
    specifiers: string[];
  }>;
  
  /** Whether this extends LightningElement */
  extendsLightningElement?: boolean;
  
  /** Custom events dispatched */
  dispatchedEvents?: string[];
}
