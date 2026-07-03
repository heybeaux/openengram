/**
 * Persistence for the structure pass.
 *
 * Bridges {@link StructurePassResult} into the `cards` and `graph_edges`
 * Prisma models. The structure pass owns the v2 structure graph end-to-end,
 * so on every successful run we **replace** the existing `graph_edges`
 * rows for the repo. For `cards`, we only touch rows at the INDEX LoD
 * (Pass 6 owns the richer LoDs) and use Prisma's `upsert` so re-runs are
 * idempotent.
 *
 * The Prisma client is injected rather than imported directly so this module
 * is trivially testable without a database.
 */

import type { Prisma, PrismaClient } from '@prisma/client';

import type {
  StructureEdge,
  StructureNode,
} from '../../parsers/types';
import type { StructurePassResult } from './orchestrator';

/**
 * Subset of Prisma we actually use. Keeping the surface minimal makes the
 * unit test's mock easier to write and harder to drift from reality.
 */
export type StructurePersistClient = Pick<PrismaClient, 'card' | 'graphEdge' | '$transaction'>;

/**
 * Counts returned from {@link persistStructurePass}.
 */
export interface PersistStructureStats {
  cardsUpserted: number;
  edgesReplaced: number;
}

/**
 * Map a v2 `StructureEdge.type` onto the Prisma `EdgeType` enum value.
 *
 * Prisma represents enum values as the SCREAMING_SNAKE string at runtime,
 * so we round-trip via uppercase to avoid pulling the enum object into
 * this module (which would force `@prisma/client` to be a real, not a
 * type-only, dependency for consumers like the orchestrator test).
 */
function toEdgeType(type: StructureEdge['type']): 'CONTAINS' | 'IMPORTS' | 'CALLS' | 'EXTENDS' {
  switch (type) {
    case 'contains':
      return 'CONTAINS';
    case 'imports':
      return 'IMPORTS';
    case 'calls':
      return 'CALLS';
    case 'extends':
      return 'EXTENDS';
  }
}

/**
 * Build the canonical `conceptPath` for a structure node.
 *
 * Format: `<repoRelativePath>#<parent?>::<name>:<kind>`. Including the kind
 * disambiguates same-named entities (an `interface Foo` vs a `class Foo`),
 * and including the parent disambiguates methods across classes. We do not
 * include line numbers because those churn across formatting changes and
 * would defeat the upsert.
 */
export function conceptPathFor(node: StructureNode): string {
  const scope = node.parent ? `${node.parent}::${node.name}` : node.name;
  return `${node.filePath}#${scope}:${node.kind}`;
}

/**
 * Human-readable one-liner used as the placeholder `content` for an INDEX
 * card. Pass 6 will replace this with a synthesized summary.
 */
function indexCardContent(node: StructureNode): string {
  const where = `${node.filePath}:${node.startLine}-${node.endLine}`;
  const scope = node.parent ? `${node.parent}.${node.name}` : node.name;
  return `\`${node.kind}\` **${scope}** — ${where}`;
}

/**
 * Persist the aggregated structure-pass output for a repo.
 *
 * - `graph_edges` for `repoId` is replaced wholesale (Pass 1 owns it).
 * - `cards` at LoD `INDEX` for `repoId` are upserted; existing higher-LoD
 *   cards (`SUMMARY`/`STANDARD`/`DEEP`) are left untouched.
 *
 * The whole operation runs in a single Prisma transaction so a crash partway
 * through doesn't leave the repo in a mixed state.
 */
export async function persistStructurePass(
  client: StructurePersistClient,
  result: StructurePassResult,
): Promise<PersistStructureStats> {
  const { repoId, nodes, edges } = result;

  const cardRows = nodes.map((node) => ({
    conceptPath: conceptPathFor(node),
    content: indexCardContent(node),
  }));

  const edgeRows = edges.map((edge) => {
    const base = {
      repoId,
      fromPath: edge.from,
      toPath: edge.to,
      edgeType: toEdgeType(edge.type),
    };
    // Only attach metadata when present; Prisma's Json? createMany input
    // does not accept a bare `null`, only `Prisma.JsonNull` or omission.
    return edge.metadata
      ? { ...base, metadata: edge.metadata as Prisma.InputJsonValue }
      : base;
  });

  // The Prisma transaction callback receives a TransactionClient (the full
  // PrismaClient minus session-scoped methods). We coerce the overload so
  // this module does not have to depend on the runtime-only
  // `Prisma.TransactionClient` symbol — only the subset we actually use.
  const runInTx = client.$transaction as unknown as (
    fn: (tx: StructurePersistClient) => Promise<unknown>,
  ) => Promise<unknown>;
  await runInTx(async (tx) => {
    // Replace the entire structure-edge set for this repo.
    await tx.graphEdge.deleteMany({ where: { repoId } });
    if (edgeRows.length > 0) {
      await tx.graphEdge.createMany({ data: edgeRows });
    }

    // Upsert one INDEX card per structural node.
    for (const row of cardRows) {
      await tx.card.upsert({
        where: {
          repoId_conceptPath_lod: {
            repoId,
            conceptPath: row.conceptPath,
            lod: 'INDEX',
          },
        },
        create: {
          repoId,
          conceptPath: row.conceptPath,
          lod: 'INDEX',
          content: row.content,
        },
        update: {
          content: row.content,
        },
      });
    }
  });

  return {
    cardsUpserted: cardRows.length,
    edgesReplaced: edgeRows.length,
  };
}
