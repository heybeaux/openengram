#!/usr/bin/env node

/**
 * @engram/mcp-server — MCP server exposing Engram memory API as tools.
 *
 * Transport: stdio (primary, for Claude Desktop) or streamable HTTP.
 * All config via environment variables. See README.md.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadConfig } from './config.js';
import { EngramAPI, EngramError } from './engram-api.js';
import { logger, setLogLevel } from './logger.js';
import { checkRateLimit } from './security/rate-limiter.js';
import {
  validateContent, validateQuery, validateId, validateLayer,
  validateLayers, validateTags, validateLimit, validateMaxTokens,
} from './security/validator.js';

// ── Bootstrap ──────────────────────────────────────────────────

const config = loadConfig();
setLogLevel(config.logLevel);

const api = new EngramAPI(config);

const server = new McpServer({
  name: 'engram',
  version: '1.0.0',
});

// ── Helper: wrap tool handler with error handling ──────────────

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

function success(data: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function error(msg: string): ToolResult {
  return { content: [{ type: 'text', text: msg }], isError: true };
}

function handleError(err: unknown, operation: string): ToolResult {
  if (err instanceof EngramError) {
    if (err.offline) {
      const lastSeen = api.getLastHealthy();
      return error(
        `Memory ${operation} unavailable — cannot reach Engram backend.${lastSeen ? ` Last seen: ${lastSeen}` : ''}`
      );
    }
    return error(err.message);
  }
  if (err instanceof Error && err.message.startsWith('Rate limit')) {
    return error(err.message);
  }
  if (err instanceof Error) {
    return error(`Validation error: ${err.message}`);
  }
  return error(`Unexpected error during ${operation}`);
}

// ── Tools ──────────────────────────────────────────────────────

server.tool(
  'engram_remember',
  'Store a memory in Engram for long-term recall. Use this to save important facts, preferences, decisions, or context that should persist across conversations.',
  {
    content: z.string().describe('Memory content to store'),
    layer: z.enum(['SESSION', 'SEMANTIC', 'CORE', 'META']).optional().describe('Memory layer (default: auto-detected)'),
    importance: z.number().min(0).max(1).optional().describe('Importance score 0-1'),
    tags: z.array(z.string()).optional().describe('Tags for categorization'),
    source: z.string().optional().describe('Source identifier'),
  },
  async (args) => {
    try {
      checkRateLimit('remember');
      const content = validateContent(args.content);
      const layer = validateLayer(args.layer);
      const tags = validateTags(args.tags);

      const result = await api.remember({
        raw: content,
        ...(layer && { layer }),
        ...(args.importance !== undefined && { importance: args.importance }),
        ...(tags && { tags }),
        ...(args.source && { source: args.source }),
      });

      return success({ stored: true, id: result.id, layer: result.layer });
    } catch (err) {
      return handleError(err, 'storage');
    }
  },
);

server.tool(
  'engram_recall',
  'Retrieve memories relevant to a query using semantic search. Returns the most relevant stored memories with relevance scores.',
  {
    query: z.string().describe('Natural language query'),
    layers: z.array(z.enum(['SESSION', 'SEMANTIC', 'CORE', 'META'])).optional().describe('Filter by memory layers'),
    limit: z.number().min(1).max(50).optional().describe('Max results (default: 10)'),
    tags: z.array(z.string()).optional().describe('Filter by tags'),
  },
  async (args) => {
    try {
      checkRateLimit('recall');
      const query = validateQuery(args.query);
      const layers = validateLayers(args.layers);
      const limit = validateLimit(args.limit);
      const tags = validateTags(args.tags);

      const results = await api.recall({
        query,
        ...(layers && { layers }),
        limit,
        ...(tags && { tags }),
      });

      // API may return an array directly or { memories: [...] } wrapper
      const memories = Array.isArray(results) ? results : ((results as any)?.memories ?? (results as any)?.data ?? []);

      if (!memories || memories.length === 0) {
        return success({ memories: [], message: 'No matching memories found.' });
      }

      return success({
        memories: memories.map((m: any) => ({
          id: m.id,
          content: m.processed || m.raw,
          layer: m.layer,
          score: m.score,
          tags: m.tags,
          created: m.createdAt,
        })),
      });
    } catch (err) {
      return handleError(err, 'recall');
    }
  },
);

server.tool(
  'engram_search',
  'Search memories with entity/graph awareness. Finds memories related to specific entities, people, projects, or concepts.',
  {
    query: z.string().describe('Search query'),
    entityType: z.string().optional().describe('Filter by entity type (e.g., person, project, concept)'),
  },
  async (args) => {
    try {
      checkRateLimit('search');
      const query = validateQuery(args.query);

      const results = await api.search({
        query,
        ...(args.entityType && { entityType: args.entityType }),
      });

      return success(results);
    } catch (err) {
      return handleError(err, 'search');
    }
  },
);

server.tool(
  'engram_forget',
  'Delete a specific memory by ID. Use with care — this is permanent.',
  {
    memoryId: z.string().describe('Memory ID to delete'),
  },
  async (args) => {
    try {
      checkRateLimit('forget');
      const id = validateId(args.memoryId);

      await api.forget(id);
      return success({ deleted: true, memoryId: id });
    } catch (err) {
      return handleError(err, 'deletion');
    }
  },
);

server.tool(
  'engram_context',
  'Generate a context window from stored memories, optimized for LLM consumption. Returns a formatted summary of relevant memories for the current conversation.',
  {
    maxTokens: z.number().min(100).max(32000).optional().describe('Token budget (default: 4000)'),
    focus: z.string().optional().describe('Optional focus topic to weight context towards'),
    projectId: z.string().optional().describe('Project scope'),
  },
  async (args) => {
    try {
      checkRateLimit('context');
      const maxTokens = validateMaxTokens(args.maxTokens);

      const result = await api.context({
        maxTokens,
        ...(args.focus && { focus: args.focus }),
        ...(args.projectId && { projectId: args.projectId }),
      });

      const contextText = typeof result === 'string' ? result : result.context;
      return success({ context: contextText });
    } catch (err) {
      return handleError(err, 'context generation');
    }
  },
);

server.tool(
  'engram_observe',
  'Auto-extract and store memories from a block of text. Engram will identify key facts, entities, and relationships to remember.',
  {
    content: z.string().describe('Text to extract memories from'),
    source: z.string().optional().describe('Source identifier (e.g., "conversation", "document")'),
  },
  async (args) => {
    try {
      checkRateLimit('observe');
      const content = validateContent(args.content);

      const result = await api.observe({
        content,
        ...(args.source && { source: args.source }),
      });

      return success({
        extracted: result.memories?.length ?? 0,
        memories: result.memories?.map(m => ({ id: m.id, content: m.raw })) ?? [],
      });
    } catch (err) {
      return handleError(err, 'observation');
    }
  },
);

// ── Resources ──────────────────────────────────────────────────

server.resource(
  'memory-stats',
  'engram://stats',
  { description: 'Current memory statistics — total count, breakdown by layer and source.' },
  async () => {
    try {
      const stats = await api.stats();
      return { contents: [{ uri: 'engram://stats', mimeType: 'application/json', text: JSON.stringify(stats, null, 2) }] };
    } catch (err) {
      const msg = err instanceof EngramError && err.offline
        ? '{"error": "Engram backend offline"}'
        : `{"error": "${err instanceof Error ? err.message : 'Unknown error'}"}`;
      return { contents: [{ uri: 'engram://stats', mimeType: 'application/json', text: msg }] };
    }
  },
);

server.resource(
  'memory-context',
  'engram://context',
  { description: 'Auto-generated context window from stored memories.' },
  async () => {
    try {
      const result = await api.context({ maxTokens: 4000 });
      const text = typeof result === 'string' ? result : result.context;
      return { contents: [{ uri: 'engram://context', mimeType: 'text/plain', text }] };
    } catch (err) {
      const msg = err instanceof EngramError && err.offline
        ? 'Engram backend offline — context unavailable'
        : `Error: ${err instanceof Error ? err.message : 'Unknown'}`;
      return { contents: [{ uri: 'engram://context', mimeType: 'text/plain', text: msg }] };
    }
  },
);

// ── Prompts ────────────────────────────────────────────────────

server.prompt(
  'memory-aware-chat',
  'Start a conversation with full memory context loaded. Retrieves relevant memories and provides them as system context.',
  { topic: z.string().optional().describe('Optional topic to focus memory retrieval on') },
  async (args) => {
    let contextText = '';
    try {
      const result = await api.context({
        maxTokens: 4000,
        ...(args.topic && { focus: args.topic }),
      });
      contextText = typeof result === 'string' ? result : result.context;
    } catch {
      contextText = 'Note: Memory context could not be loaded (Engram may be offline).';
    }

    return {
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: [
              '## Memory Context',
              '',
              contextText,
              '',
              '---',
              '',
              args.topic
                ? `Let\'s discuss: ${args.topic}`
                : 'How can I help you today? I have your memory context loaded above.',
            ].join('\n'),
          },
        },
      ],
    };
  },
);

// ── Start ──────────────────────────────────────────────────────

async function main() {
  logger.info('Starting engram-mcp server', {
    baseUrl: config.baseUrl,
    userId: config.userId,
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info('engram-mcp server connected via stdio');
}

main().catch((err) => {
  console.error('Fatal error starting engram-mcp:', err);
  process.exit(1);
});
