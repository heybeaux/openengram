import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as fs from 'fs';
import * as path from 'path';

export interface GenerateContextOptions {
  agentId: string;
  maxTokens?: number;
  writePath?: string;
  dryRun?: boolean;
}

export interface GenerateContextResult {
  markdown: string;
  tokenCount: number;
  memoriesIncluded: number;
  memoriesTotal: number;
  categories: {
    userIdentity: number;
    activeProjects: number;
    keyLessons: number;
    recentContext: number;
  };
  writtenTo: string | null;
  latencyMs: number;
}

interface CategorizedMemory {
  id: string;
  raw: string;
  effectiveScore: number;
  confidence: number;
  category: 'userIdentity' | 'activeProjects' | 'keyLessons' | 'recentContext';
}

@Injectable()
export class GenerateContextService {
  private readonly logger = new Logger(GenerateContextService.name);

  constructor(private prisma: PrismaService) {}

  async generate(options: GenerateContextOptions): Promise<GenerateContextResult> {
    const startTime = Date.now();
    const maxTokens = options.maxTokens ?? 2000;
    const dryRun = options.dryRun ?? false;

    // Query all active memories for this agent
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const memories = await this.prisma.memory.findMany({
      where: {
        agentId: options.agentId,
        deletedAt: null,
        archivedReason: null,
      },
      orderBy: [
        { effectiveScore: 'desc' },
        { confidence: 'desc' },
      ],
      select: {
        id: true,
        raw: true,
        effectiveScore: true,
        confidence: true,
        layer: true,
        memoryType: true,
        subjectType: true,
        usedCount: true,
        createdAt: true,
        safetyCritical: true,
      },
    });

    const totalMemories = memories.length;

    // Categorize memories
    const categorized: CategorizedMemory[] = [];

    for (const m of memories) {
      let category: CategorizedMemory['category'];

      // Priority: LESSON/CONSTRAINT first
      if (m.memoryType === 'LESSON' || m.memoryType === 'CONSTRAINT' || m.safetyCritical) {
        category = 'keyLessons';
      } else if (m.layer === 'PROJECT' || m.memoryType === 'TASK') {
        category = 'activeProjects';
      } else if (
        m.subjectType === 'USER' ||
        m.memoryType === 'PREFERENCE' ||
        m.memoryType === 'FACT' ||
        m.layer === 'IDENTITY'
      ) {
        category = 'userIdentity';
      } else if (m.createdAt >= sevenDaysAgo && m.usedCount > 0) {
        category = 'recentContext';
      } else if (m.createdAt >= sevenDaysAgo) {
        category = 'recentContext';
      } else {
        // Default: put high-score items in recent context, low in identity
        category = m.effectiveScore >= 0.5 ? 'recentContext' : 'userIdentity';
      }

      categorized.push({
        id: m.id,
        raw: m.raw,
        effectiveScore: m.effectiveScore,
        confidence: m.confidence,
        category,
      });
    }

    // Budget allocation
    const budgets: Record<CategorizedMemory['category'], number> = {
      activeProjects: Math.floor(maxTokens * 0.30),
      recentContext: Math.floor(maxTokens * 0.25),
      keyLessons: Math.floor(maxTokens * 0.20),
      userIdentity: Math.floor(maxTokens * 0.15),
    };
    // 10% buffer is unused allocation

    // Group by category (already sorted by effectiveScore desc from query)
    const groups: Record<CategorizedMemory['category'], CategorizedMemory[]> = {
      userIdentity: [],
      activeProjects: [],
      keyLessons: [],
      recentContext: [],
    };

    for (const m of categorized) {
      groups[m.category].push(m);
    }

    // Select memories per category within budget, with dedup
    const selected: Record<CategorizedMemory['category'], string[]> = {
      userIdentity: [],
      activeProjects: [],
      keyLessons: [],
      recentContext: [],
    };
    const allSelectedTexts: string[] = [];
    const counts = { userIdentity: 0, activeProjects: 0, keyLessons: 0, recentContext: 0 };

    const categories: CategorizedMemory['category'][] = ['keyLessons', 'activeProjects', 'recentContext', 'userIdentity'];

    for (const cat of categories) {
      let tokensBudget = budgets[cat];
      for (const m of groups[cat]) {
        if (tokensBudget <= 0) break;
        const tokens = this.estimateTokens(m.raw);
        if (tokens > tokensBudget) continue;

        // Dedup check
        if (this.isDuplicate(m.raw, allSelectedTexts)) continue;

        selected[cat].push(m.raw);
        allSelectedTexts.push(m.raw);
        tokensBudget -= tokens;
        counts[cat]++;
      }
    }

    // Build markdown
    const totalIncluded = Object.values(counts).reduce((a, b) => a + b, 0);
    const allText = Object.values(selected).flat().join('\n');
    const totalTokens = this.estimateTokens(allText);

    const sections: string[] = [];
    sections.push(`# Memory Context (via Engram)`);
    sections.push('');
    sections.push(`*${totalIncluded} memories loaded, ${Math.round(totalTokens)} tokens*`);
    sections.push('');
    sections.push('> **Note:** Focus on memories relevant to the current project.');
    sections.push('> Cross-project memories are included for reference but should not');
    sections.push('> influence actions on the current project.');

    const sectionDefs: { key: CategorizedMemory['category']; title: string }[] = [
      { key: 'userIdentity', title: 'User Identity' },
      { key: 'activeProjects', title: 'Active Projects' },
      { key: 'keyLessons', title: 'Key Lessons' },
      { key: 'recentContext', title: 'Recent Context' },
    ];

    for (const { key, title } of sectionDefs) {
      if (selected[key].length > 0) {
        sections.push('');
        sections.push(`## ${title}`);
        for (const text of selected[key]) {
          sections.push(`- ${text}`);
        }
      }
    }

    const markdown = sections.join('\n') + '\n';

    // File writing
    let writtenTo: string | null = null;
    if (options.writePath && !dryRun) {
      try {
        const dir = path.dirname(options.writePath);
        fs.mkdirSync(dir, { recursive: true });

        if (fs.existsSync(options.writePath)) {
          fs.copyFileSync(options.writePath, options.writePath + '.bak');
        }

        fs.writeFileSync(options.writePath, markdown, 'utf-8');
        writtenTo = options.writePath;
        this.logger.log(`Wrote context to ${options.writePath}`);
      } catch (err) {
        this.logger.error(`Failed to write context file: ${err}`);
      }
    }

    return {
      markdown,
      tokenCount: Math.round(totalTokens),
      memoriesIncluded: totalIncluded,
      memoriesTotal: totalMemories,
      categories: counts,
      writtenTo,
      latencyMs: Date.now() - startTime,
    };
  }

  private estimateTokens(text: string): number {
    return text.split(/\s+/).filter(Boolean).length * 1.3;
  }

  private isDuplicate(text: string, existing: string[]): boolean {
    const words = new Set(text.toLowerCase().split(/\s+/).filter(Boolean));
    if (words.size === 0) return true;

    for (const other of existing) {
      const otherWords = new Set(other.toLowerCase().split(/\s+/).filter(Boolean));
      const intersection = [...words].filter(w => otherWords.has(w));
      const union = new Set([...words, ...otherWords]);
      const similarity = intersection.length / union.size;
      if (similarity > 0.9) return true;
    }
    return false;
  }
}
