import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmbeddingService } from '../memory/embedding.service';
import { LLMService } from '../llm/llm.service';
import { Memory, MemorySource } from '@prisma/client';

/**
 * Result of a contradiction check
 */
export interface ContradictionCheckResult {
  contradictions: Array<{
    existingMemoryId: string;
    similarity: number;
    isContradiction: boolean;
    explanation: string;
  }>;
  superseded: string[]; // IDs of memories that were superseded
}

/**
 * CorrectionService — Automatic Memory Correction
 *
 * When a new memory is created, this service:
 * 1. Searches for semantically similar existing memories (same topic)
 * 2. Uses an LLM to determine if any are contradicted by the new memory
 * 3. Automatically supersedes contradicted memories
 *
 * Also provides a manual correction endpoint.
 */
@Injectable()
export class CorrectionService {
  private readonly logger = new Logger(CorrectionService.name);

  // Similarity threshold for candidate contradictions (same topic)
  private readonly SIMILARITY_THRESHOLD = 0.7;
  // Max candidates to check with LLM
  private readonly MAX_CANDIDATES = 5;

  constructor(
    private readonly prisma: PrismaService,
    private readonly embedding: EmbeddingService,
    private readonly llm: LLMService,
  ) {}

  /**
   * Check a newly created memory for contradictions with existing memories.
   * Called automatically after memory creation.
   *
   * @param memoryId - The newly created memory's ID
   * @param userId - The user who owns the memory
   * @param content - Raw text of the new memory
   */
  async checkForContradictions(
    memoryId: string,
    userId: string,
    content: string,
  ): Promise<ContradictionCheckResult> {
    const result: ContradictionCheckResult = {
      contradictions: [],
      superseded: [],
    };

    try {
      // 1. Generate embedding for the new memory content
      const queryEmbedding = await this.embedding.generate(content);

      // 2. Search for similar memories (same topic area)
      const similar = await this.embedding.search(
        userId,
        queryEmbedding,
        this.MAX_CANDIDATES + 1, // +1 because the new memory itself might be in results
      );

      // 3. Filter out the new memory itself and apply threshold
      const candidates = similar.filter(
        (r) => r.id !== memoryId && r.score >= this.SIMILARITY_THRESHOLD,
      );

      if (candidates.length === 0) {
        this.logger.debug(
          `[Correction] No similar candidates for memory ${memoryId}`,
        );
        return result;
      }

      // 4. Fetch full content of candidate memories
      const candidateMemories = await this.prisma.memory.findMany({
        where: {
          id: { in: candidates.map((c) => c.id) },
          deletedAt: null,
          supersededById: null, // Don't check already-superseded memories
        },
      });

      if (candidateMemories.length === 0) {
        return result;
      }

      // 5. Use LLM to detect contradictions
      const contradictions = await this.detectContradictionsWithLLM(
        content,
        candidateMemories,
        candidates,
      );

      result.contradictions = contradictions;

      // 6. Supersede contradicted memories
      for (const contradiction of contradictions) {
        if (contradiction.isContradiction) {
          await this.supersedeMemory(
            contradiction.existingMemoryId,
            memoryId,
            contradiction.explanation,
          );
          result.superseded.push(contradiction.existingMemoryId);
        }
      }

      if (result.superseded.length > 0) {
        this.logger.log(
          `[Correction] Memory ${memoryId} superseded ${result.superseded.length} memories: [${result.superseded.join(', ')}]`,
        );
      }
    } catch (error) {
      this.logger.error(
        `[Correction] Failed to check contradictions for memory ${memoryId}:`,
        error,
      );
      // Don't throw — correction is best-effort, shouldn't block memory creation
    }

    return result;
  }

  /**
   * Use LLM to determine if new memory contradicts existing ones.
   */
  private async detectContradictionsWithLLM(
    newContent: string,
    existingMemories: Memory[],
    similarityResults: Array<{ id: string; score: number }>,
  ): Promise<ContradictionCheckResult['contradictions']> {
    const scoreMap = new Map(similarityResults.map((r) => [r.id, r.score]));

    // Build the prompt with all candidates
    const memoriesList = existingMemories
      .map((m, i) => `[${i + 1}] (ID: ${m.id}) "${m.raw}"`)
      .join('\n');

    const messages = [
      {
        role: 'system' as const,
        content: `You are a memory contradiction detector. Given a NEW memory and a list of EXISTING memories, determine which existing memories are CONTRADICTED by the new one.

A contradiction means the new memory states something that directly conflicts with or replaces the information in an existing memory. Examples:
- "I prefer dark chocolate" contradicts "I prefer white chocolate"
- "My wife's name is Sarah" contradicts "My wife's name is Emma"
- "I work at Google" contradicts "I work at Microsoft"

NOT contradictions:
- Additional details about the same topic (complementary info)
- Updates that don't conflict (e.g., "I'm now learning Python" doesn't contradict "I know JavaScript")
- Different aspects of the same subject

Respond with a JSON array. For each existing memory, include:
- "index": the memory number (1-based)
- "isContradiction": true/false
- "explanation": brief reason

Only include memories that ARE contradictions. Return empty array [] if none.`,
      },
      {
        role: 'user' as const,
        content: `NEW MEMORY: "${newContent}"

EXISTING MEMORIES:
${memoriesList}

Which existing memories are contradicted by the new memory?`,
      },
    ];

    try {
      const response = await this.llm.json<
        Array<{
          index: number;
          isContradiction: boolean;
          explanation: string;
        }>
      >(messages);

      // Map LLM response back to memory IDs
      return (response || [])
        .filter(
          (r) =>
            r.isContradiction &&
            r.index >= 1 &&
            r.index <= existingMemories.length,
        )
        .map((r) => ({
          existingMemoryId: existingMemories[r.index - 1].id,
          similarity: scoreMap.get(existingMemories[r.index - 1].id) ?? 0,
          isContradiction: true,
          explanation: r.explanation,
        }));
    } catch (error) {
      this.logger.error(
        '[Correction] LLM contradiction detection failed:',
        error,
      );
      return [];
    }
  }

  /**
   * Mark an existing memory as superseded by a new one.
   */
  private async supersedeMemory(
    existingMemoryId: string,
    newMemoryId: string,
    explanation: string,
  ): Promise<void> {
    // 1. Update the existing memory
    await this.prisma.memory.update({
      where: { id: existingMemoryId },
      data: {
        supersededById: newMemoryId,
        supersededAt: new Date(),
      },
    });

    // 2. Create a CONTRADICTS chain link
    try {
      await this.prisma.memoryChainLink.create({
        data: {
          sourceId: newMemoryId,
          targetId: existingMemoryId,
          linkType: 'CONTRADICTS',
          confidence: 1.0,
          createdBy: `auto:correction:${explanation.substring(0, 100)}`,
        },
      });
    } catch (error) {
      // Link might already exist if manual correction was done
      this.logger.warn(
        `[Correction] Could not create CONTRADICTS link: ${error.message}`,
      );
    }
  }

  /**
   * Manual correction endpoint — supersede a specific memory with new content.
   * Creates a new correction memory and marks the old one as superseded.
   */
  async manualCorrect(
    userId: string,
    memoryId: string,
    correctedContent: string,
    reason?: string,
  ): Promise<{ correctionId: string; supersededId: string }> {
    // 1. Verify the memory exists and belongs to the user
    const existing = await this.prisma.memory.findUnique({
      where: { id: memoryId },
    });

    if (!existing) {
      throw new Error(`Memory not found: ${memoryId}`);
    }
    if (existing.userId !== userId) {
      throw new Error('Access denied: Memory belongs to another user');
    }
    if (existing.deletedAt) {
      throw new Error(`Cannot correct deleted memory: ${memoryId}`);
    }
    if (existing.supersededById) {
      throw new Error(
        `Memory already superseded by: ${existing.supersededById}`,
      );
    }

    // 2. Create the correction memory
    const correction = await this.prisma.memory.create({
      data: {
        userId,
        raw: correctedContent,
        layer: existing.layer,
        source: MemorySource.CORRECTION,
        importanceScore: Math.min(1.0, existing.importanceScore + 0.1),
        confidence: 1.0,
        projectId: existing.projectId,
        sessionId: existing.sessionId,
      },
    });

    // 3. Supersede the old memory
    await this.supersedeMemory(
      memoryId,
      correction.id,
      reason ?? 'manual correction',
    );

    // 4. Generate embedding for the correction (async)
    this.embedding
      .generate(correctedContent)
      .then((emb) =>
        this.embedding.store(correction.id, emb, {
          userId,
          layer: existing.layer,
          importance: correction.importanceScore,
        }),
      )
      .catch((err) =>
        this.logger.error(
          `[Correction] Embedding failed for ${correction.id}:`,
          err,
        ),
      );

    this.logger.log(
      `[Correction] Manual correction: ${correction.id} supersedes ${memoryId}`,
    );

    return {
      correctionId: correction.id,
      supersededId: memoryId,
    };
  }
}
