/**
 * Core types for the engram-code v2 parser framework.
 *
 * These types are intentionally language-agnostic. Each language extractor
 * (TS, Python, Go, ...) returns the same `ParseResult` shape so downstream
 * passes (structure graph, intent, contracts, synthesis) can operate uniformly.
 */

/**
 * A coarse classification of an AST node that engram-code v2 cares about.
 *
 * Language-specific extractors map their native AST node types onto these
 * kinds. Anything that does not map cleanly should simply be omitted from
 * the result — `StructureNode`s are a curated projection, not a full AST.
 */
export type NodeKind =
  | 'module'
  | 'function'
  | 'class'
  | 'interface'
  | 'method'
  | 'import'
  | 'export'
  | 'call';

/**
 * A single node in the structural graph for a file.
 */
export interface StructureNode {
  /** Coarse node classification. */
  kind: NodeKind;
  /** Human-readable name (symbol name, module name, etc.). */
  name: string;
  /** Path to the source file, relative to repo root. */
  filePath: string;
  /** 1-based start line, inclusive. */
  startLine: number;
  /** 1-based end line, inclusive. */
  endLine: number;
  /**
   * Qualified parent name (e.g. `ClassName` for a method, or a module path).
   * Optional — top-level nodes have no parent.
   */
  parent?: string;
  /** Language-specific extras (visibility, decorators, generics, etc.). */
  metadata?: Record<string, unknown>;
}

/**
 * A typed edge between two structural entities.
 *
 * `from` and `to` are qualified names (preferred) or file paths when no
 * better identifier exists. Edge interpretation is up to the extractor;
 * downstream passes treat edges as opaque except for the `type` discriminator.
 */
export interface StructureEdge {
  from: string;
  to: string;
  type: 'contains' | 'imports' | 'calls' | 'extends';
  metadata?: Record<string, unknown>;
}

/**
 * The full result of parsing a single file.
 *
 * `parseErrors` is a soft channel: extractors should populate it instead of
 * throwing so the pipeline can keep moving through a partially-broken repo.
 */
export interface ParseResult {
  /** Path to the source file, relative to repo root. */
  filePath: string;
  /** Logical language identifier (e.g. `typescript`, `python`, `go`). */
  language: string;
  nodes: StructureNode[];
  edges: StructureEdge[];
  parseErrors: string[];
}

/**
 * Contract every language extractor must satisfy.
 *
 * Extractors are registered in the language registry by extension. They
 * should be pure with respect to the inputs — no I/O, no global state.
 */
export interface LanguageExtractor {
  /** Logical language identifier; matches `ParseResult.language`. */
  language: string;
  /** File extensions this extractor handles, including the leading dot. */
  extensions: string[];
  /**
   * Extract structure from a single file's source.
   *
   * @param filePath path relative to repo root (used only for ParseResult)
   * @param source   full file contents as a string
   */
  parse(filePath: string, source: string): ParseResult;
}
