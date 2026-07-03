/**
 * engram-code parsers
 * Language-specific parsers for code ingestion
 */

export * from './parser.interface';
export * from './apex.parser';
export * from './lwc.parser';
export * from './typescript.parser';

import { ApexParser } from './apex.parser';
import { LwcParser } from './lwc.parser';
import { TypeScriptParser } from './typescript.parser';
import { Parser, ParseResult } from './parser.interface';

/**
 * Registry of all available parsers
 */
export const parsers: Parser[] = [
  new ApexParser(),
  new LwcParser(),
  new TypeScriptParser(),
];

/**
 * Get the appropriate parser for a file path
 * @param filePath - Path to the file
 * @returns The parser that can handle this file, or undefined
 */
export function getParserForFile(filePath: string): Parser | undefined {
  return parsers.find(p => p.canParse(filePath));
}

/**
 * Parse a file using the appropriate parser
 * @param content - File content
 * @param filePath - Path to the file
 * @returns ParseResult or undefined if no parser can handle the file
 */
export function parseFile(content: string, filePath: string): ParseResult | undefined {
  const parser = getParserForFile(filePath);
  if (!parser) return undefined;
  return parser.parse(content, filePath);
}
