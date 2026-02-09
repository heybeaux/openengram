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
  memoriesFiltered: number;
  categories: {
    userIdentity: number;
    currentProject: number;
    activeProjects: number;
    keyLessons: number;
    recentContext: number;
  };
  writtenTo: string | null;
  latencyMs: number;
}

type CategoryKey = 'userIdentity' | 'currentProject' | 'activeProjects' | 'keyLessons' | 'recentContext';

interface CategorizedMemory {
  id: string;
  raw: string;
  effectiveScore: number;
  confidence: number;
  createdAt: Date;
  layer: string | null;
  memoryType: string | null;
  category: CategoryKey;
}

@Injectable()
export class GenerateContextService {
  private readonly logger = new Logger(GenerateContextService.name);

  constructor(private prisma: PrismaService) {}

  async generate(options: GenerateContextOptions): Promise<GenerateContextResult> {
    const startTime = Date.now();
    const maxTokens = options.maxTokens ?? 2000;
    const dryRun = options.dryRun ?? false;

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Query all active memories for this agent
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
        archivedReason: true,
        supersededById: true,
        consolidatedInto: true,
      },
    });

    const totalMemories = memories.length;

    // === Task 1: Pre-filter stale/superseded memories ===
    const filtered = memories.filter(m => {
      if (m.effectiveScore < 0.3) return false;
      if (m.supersededById != null) return false;
      if (m.consolidatedInto != null) return false;
      if (m.archivedReason != null) return false; // already excluded by query, but belt-and-suspenders
      return true;
    });
    const memoriesFiltered = totalMemories - filtered.length;
    this.logger.log(`Pre-filter: excluded ${memoriesFiltered} stale/superseded memories`);

    // === Task 5: Detect current project from last 24h high-score PROJECT memories ===
    const recentProjectMemories = filtered.filter(
      m => m.layer === 'PROJECT' && m.createdAt >= oneDayAgo && m.effectiveScore >= 0.5,
    );
    const projectCounts = new Map<string, number>();
    for (const m of recentProjectMemories) {
      // Extract project name from raw text (first significant noun phrase or keyword)
      const text = m.raw.toLowerCase();
      // Simple heuristic: look for known project patterns
      const projectPatterns = text.match(/(?:working on|building|project[:\s]+|developing)\s+([a-z][\w\s-]+)/i);
      const projectName = projectPatterns ? projectPatterns[1].trim() : text.slice(0, 50);
      projectCounts.set(projectName, (projectCounts.get(projectName) || 0) + 1);
    }
    let currentProjectName: string | null = null;
    if (projectCounts.size > 0) {
      currentProjectName = Array.from(projectCounts.entries()).sort((a, b) => b[1] - a[1])[0][0];
    }

    // === Task 2: Recent-first categorization ===
    // FIRST: select recent memories (last 7 days) for recentContext bucket
    const recentMemories: typeof filtered = [];
    const remainingMemories: typeof filtered = [];

    for (const m of filtered) {
      if (m.createdAt >= sevenDaysAgo) {
        recentMemories.push(m);
      } else {
        remainingMemories.push(m);
      }
    }
    // recentMemories already sorted by effectiveScore desc from query

    // THEN: categorize remaining memories by type
    const categorized: CategorizedMemory[] = [];

    // Mark recent memories for recentContext bucket
    for (const m of recentMemories) {
      categorized.push({
        id: m.id,
        raw: m.raw,
        effectiveScore: m.effectiveScore,
        confidence: m.confidence,
        createdAt: m.createdAt,
        layer: m.layer,
        memoryType: m.memoryType,
        category: 'recentContext',
      });
    }

    // Categorize older memories by type
    for (const m of remainingMemories) {
      let category: CategoryKey;

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
      } else {
        category = 'userIdentity';
      }

      categorized.push({
        id: m.id,
        raw: m.raw,
        effectiveScore: m.effectiveScore,
        confidence: m.confidence,
        createdAt: m.createdAt,
        layer: m.layer,
        memoryType: m.memoryType,
        category,
      });
    }

    // === Task 3: Rebalanced budget allocation ===
    const budgets: Record<CategoryKey, number> = {
      recentContext: Math.floor(maxTokens * 0.30),
      activeProjects: Math.floor(maxTokens * 0.20),
      userIdentity: Math.floor(maxTokens * 0.20),
      keyLessons: Math.floor(maxTokens * 0.20),
      currentProject: 0, // carved out from activeProjects below
    };
    // 10% buffer is unused allocation

    // If we detected a current project, carve out half of activeProjects budget for it
    if (currentProjectName) {
      budgets.currentProject = Math.floor(budgets.activeProjects * 0.5);
      budgets.activeProjects -= budgets.currentProject;
    }

    // Group by category
    const groups: Record<CategoryKey, CategorizedMemory[]> = {
      userIdentity: [],
      currentProject: [],
      activeProjects: [],
      keyLessons: [],
      recentContext: [],
    };

    for (const m of categorized) {
      // Split activeProjects into currentProject vs activeProjects
      if (m.category === 'activeProjects' && currentProjectName && m.raw.toLowerCase().includes(currentProjectName)) {
        groups.currentProject.push(m);
      } else {
        groups[m.category].push(m);
      }
    }

    // Also pull current project memories from recentContext
    if (currentProjectName) {
      const moved: CategorizedMemory[] = [];
      groups.recentContext = groups.recentContext.filter(m => {
        if ((m.layer === 'PROJECT' || m.memoryType === 'TASK') && m.raw.toLowerCase().includes(currentProjectName!)) {
          moved.push(m);
          return false;
        }
        return true;
      });
      groups.currentProject.push(...moved);
    }

    // Select memories per category within budget, with dedup
    // Process order: keyLessons, currentProject, recentContext, activeProjects, userIdentity
    const selected: Record<CategoryKey, string[]> = {
      userIdentity: [],
      currentProject: [],
      activeProjects: [],
      keyLessons: [],
      recentContext: [],
    };
    const allSelectedTexts: string[] = [];
    const counts: Record<CategoryKey, number> = {
      userIdentity: 0, currentProject: 0, activeProjects: 0, keyLessons: 0, recentContext: 0,
    };

    const processingOrder: CategoryKey[] = ['keyLessons', 'currentProject', 'recentContext', 'activeProjects', 'userIdentity'];

    for (const cat of processingOrder) {
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

    // Section definitions with current project first if present
    const sectionDefs: { key: CategoryKey; title: string }[] = [
      { key: 'userIdentity', title: 'User Identity' },
    ];

    if (currentProjectName && selected.currentProject.length > 0) {
      sectionDefs.push({
        key: 'currentProject',
        title: `Current Project`,
      });
    }

    sectionDefs.push(
      { key: 'activeProjects', title: 'Active Projects' },
      { key: 'keyLessons', title: 'Key Lessons' },
      { key: 'recentContext', title: 'Recent Context' },
    );

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
      memoriesFiltered,
      categories: counts,
      writtenTo,
      latencyMs: Date.now() - startTime,
    };
  }

  private estimateTokens(text: string): number {
    return text.split(/\s+/).filter(Boolean).length * 1.3;
  }

  // === Task 4: Improved dedup with lower Jaccard threshold + substring containment ===
  private isDuplicate(text: string, existing: string[]): boolean {
    const normalizedText = text.toLowerCase();
    const words = new Set(normalizedText.split(/\s+/).filter(Boolean));
    if (words.size === 0) return true;

    for (const other of existing) {
      const normalizedOther = other.toLowerCase();
      const otherWords = new Set(normalizedOther.split(/\s+/).filter(Boolean));

      // Jaccard similarity check (threshold lowered from 0.9 to 0.7)
      const intersection = Array.from(words).filter(w => otherWords.has(w));
      const unionSet = new Set(Array.from(words).concat(Array.from(otherWords)));
      const similarity = intersection.length / unionSet.size;
      if (similarity > 0.7) return true;

      // Substring containment check: if 80%+ of one text's words are in the other
      const smallerWords = words.size <= otherWords.size ? words : otherWords;
      const largerWords = words.size <= otherWords.size ? otherWords : words;
      const contained = Array.from(smallerWords).filter(w => largerWords.has(w));
      if (smallerWords.size > 0 && contained.length / smallerWords.size >= 0.8) return true;
    }
    return false;
  }
}
