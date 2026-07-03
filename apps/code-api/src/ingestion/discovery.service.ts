/**
 * Discovery Service
 * Walks directory tree, discovers files, detects language
 */

import * as fs from 'fs';
import * as path from 'path';
import { Language, DiscoveredFile } from './types';

// Directories to skip
const IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  '.sfdx',
  'dist',
  'build',
  'coverage',
  '__tests__',
  '.husky',
  '.vscode',
  '.idea',
]);

// Extension to language mapping
const EXTENSION_LANGUAGE_MAP: Record<string, Language> = {
  '.cls': Language.APEX,
  '.trigger': Language.APEX,
  '.ts': Language.TYPESCRIPT,
  '.tsx': Language.TYPESCRIPT,
  '.jsx': Language.JAVASCRIPT,
  '.py': Language.PYTHON,
};

// Extensions that need context-aware detection
const CONTEXT_EXTENSIONS = new Set(['.js', '.html', '.css', '.xml']);

export interface DiscoveryOptions {
  rootPath: string;
  languages?: Language[];
  customIgnore?: string[];
}

export interface DiscoveryResult {
  files: DiscoveredFile[];
  stats: {
    totalFiles: number;
    byLanguage: Record<Language, number>;
    skippedDirs: number;
    skippedSymlinks: number;
  };
}

/**
 * Discovers files in a directory tree
 */
export async function discoverFiles(options: DiscoveryOptions): Promise<DiscoveryResult> {
  const { rootPath, languages, customIgnore = [] } = options;
  const files: DiscoveredFile[] = [];
  const ignoreSet = new Set([...IGNORE_DIRS, ...customIgnore]);
  let skippedDirs = 0;

  // Validate root path
  if (!fs.existsSync(rootPath)) {
    throw new Error(`Root path does not exist: ${rootPath}`);
  }

  const stats = fs.statSync(rootPath);
  if (!stats.isDirectory()) {
    throw new Error(`Root path is not a directory: ${rootPath}`);
  }

  let skippedFiles = 0;

  // Walk directory tree
  async function walkDir(dir: string): Promise<void> {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      // Skip symlinks to prevent traversal attacks
      if (entry.isSymbolicLink()) {
        skippedFiles++;
        continue;
      }

      if (entry.isDirectory()) {
        // Skip ignored directories
        if (ignoreSet.has(entry.name)) {
          skippedDirs++;
          continue;
        }
        await walkDir(fullPath);
      } else if (entry.isFile()) {
        const discovered = detectFile(fullPath, rootPath, dir);
        if (discovered) {
          // Filter by requested languages if specified
          if (!languages || languages.includes(discovered.language)) {
            files.push(discovered);
          }
        }
      }
    }
  }

  await walkDir(rootPath);

  // Compute stats
  const byLanguage: Record<Language, number> = {} as Record<Language, number>;
  for (const file of files) {
    byLanguage[file.language] = (byLanguage[file.language] || 0) + 1;
  }

  return {
    files,
    stats: {
      totalFiles: files.length,
      byLanguage,
      skippedDirs,
      skippedSymlinks: skippedFiles,
    },
  };
}

/**
 * Detect if a file should be included and what language it is
 */
function detectFile(
  absolutePath: string,
  rootPath: string,
  parentDir: string
): DiscoveredFile | null {
  const ext = path.extname(absolutePath).toLowerCase();
  const relativePath = path.relative(rootPath, absolutePath);

  // Direct extension mapping
  if (EXTENSION_LANGUAGE_MAP[ext]) {
    return {
      absolutePath,
      relativePath,
      language: EXTENSION_LANGUAGE_MAP[ext],
      extension: ext,
    };
  }

  // Context-aware detection for JS/HTML/CSS/XML
  if (CONTEXT_EXTENSIONS.has(ext)) {
    const language = detectLanguageFromContext(absolutePath, parentDir, ext);
    if (language) {
      return {
        absolutePath,
        relativePath,
        language,
        extension: ext,
      };
    }
  }

  return null;
}

/**
 * Detect language based on file context (e.g., LWC vs plain JS)
 */
function detectLanguageFromContext(
  absolutePath: string,
  parentDir: string,
  ext: string
): Language | null {
  // Check if this is in an LWC folder
  const isInLwc = parentDir.includes('/lwc/') || parentDir.includes('\\lwc\\');

  switch (ext) {
    case '.js': {
      // JavaScript in LWC folder = LWC component
      if (isInLwc) {
        return Language.LWC;
      }
      // Regular JS files (skip config files like jest.config.js)
      const basename = path.basename(absolutePath);
      if (basename.includes('.config.') || basename.startsWith('.')) {
        return null;
      }
      return Language.JAVASCRIPT;
    }

    case '.html':
      // HTML only relevant in LWC context
      if (isInLwc) {
        return Language.HTML;
      }
      return null;

    case '.css':
      // CSS only relevant in LWC context
      if (isInLwc) {
        return Language.CSS;
      }
      return null;

    case '.xml':
      // XML in force-app = Salesforce metadata
      if (
        absolutePath.includes('force-app') ||
        absolutePath.includes('/lwc/') ||
        absolutePath.includes('/classes/')
      ) {
        return Language.XML;
      }
      return null;

    default:
      return null;
  }
}

/**
 * Get a summary of discovered files
 */
export function formatDiscoverySummary(result: DiscoveryResult): string {
  const lines = [
    `Discovered ${result.stats.totalFiles} files`,
    `Skipped ${result.stats.skippedDirs} directories`,
    '',
    'By language:',
  ];

  for (const [lang, count] of Object.entries(result.stats.byLanguage)) {
    lines.push(`  ${lang}: ${count}`);
  }

  return lines.join('\n');
}
