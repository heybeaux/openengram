import { Injectable } from '@nestjs/common';
import { LLMService } from '../llm/llm.service';

export interface ExtractionResult {
  who: string | null;
  what: string | null;
  when: string | null; // ISO date string or relative time
  where: string | null;
  why: string | null;
  how: string | null;
  topics: string[];
  entities: string[];
}

const EXTRACTION_PROMPT = `You are a memory extraction system. Given a piece of text, extract structured information using the 5W1H framework.

Extract:
- WHO: People, organizations, or entities mentioned
- WHAT: The core fact, action, or statement
- WHEN: Any temporal context (dates, times, relative references)
- WHERE: Location, context, or setting
- WHY: Reasoning, motivation, or cause
- HOW: Method, manner, or process
- TOPICS: Relevant categories (e.g., "preferences", "work", "technical", "personal")
- ENTITIES: Named entities (people, organizations, products, projects)

If a field cannot be determined from the text, set it to null.
For topics and entities, return empty arrays if none found.

Respond with JSON only. No explanation.`;

interface ExtractionResponse {
  who: string | null;
  what: string | null;
  when: string | null;
  where: string | null;
  why: string | null;
  how: string | null;
  topics: string[];
  entities: string[];
}

/**
 * Extracts structured 5W1H data from raw memory text
 * Uses configured LLM provider for extraction
 */
@Injectable()
export class ExtractionService {
  constructor(private llm: LLMService) {}

  /**
   * Extract 5W1H structure from raw text using LLM
   */
  async extract(raw: string): Promise<ExtractionResult> {
    try {
      const result = await this.llm.json<ExtractionResponse>(
        [
          { role: 'system', content: EXTRACTION_PROMPT },
          { role: 'user', content: `Extract from this memory:\n\n"${raw}"` },
        ],
        undefined,
        { temperature: 0.2 }, // Low temperature for consistent extraction
      );

      return {
        who: result.who || null,
        what: result.what || null,
        when: result.when || null,
        where: result.where || null,
        why: result.why || null,
        how: result.how || null,
        topics: Array.isArray(result.topics) ? result.topics : [],
        entities: Array.isArray(result.entities) ? result.entities : [],
      };
    } catch (error) {
      console.error('LLM extraction failed, falling back to basic extraction:', error);
      return this.basicExtraction(raw);
    }
  }

  /**
   * Fallback basic extraction when LLM is unavailable
   */
  private basicExtraction(raw: string): ExtractionResult {
    return {
      who: this.extractWho(raw),
      what: raw.length > 200 ? raw.substring(0, 200) + '...' : raw,
      when: null,
      where: null,
      why: null,
      how: null,
      topics: this.extractTopics(raw),
      entities: this.extractEntities(raw),
    };
  }

  /**
   * Basic WHO extraction (looks for names)
   */
  private extractWho(raw: string): string | null {
    const namePattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g;
    const matches = raw.match(namePattern);

    if (matches && matches.length > 0) {
      const commonWords = new Set([
        'The', 'This', 'That', 'I', 'We', 'They', 'It', 'He', 'She',
        'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December',
      ]);
      const names = matches.filter((m) => !commonWords.has(m));
      return names.length > 0 ? names[0] : null;
    }

    return null;
  }

  /**
   * Basic topic extraction
   */
  private extractTopics(raw: string): string[] {
    const topics: Set<string> = new Set();
    const lowered = raw.toLowerCase();

    const topicKeywords: Record<string, string[]> = {
      coding: ['code', 'programming', 'developer', 'api', 'function', 'bug', 'deploy'],
      design: ['design', 'ui', 'ux', 'layout', 'color', 'font', 'style'],
      business: ['meeting', 'client', 'project', 'deadline', 'budget', 'pricing'],
      preferences: ['prefer', 'like', 'hate', 'favorite', 'always', 'never'],
      technical: ['database', 'server', 'api', 'integration', 'architecture'],
    };

    for (const [topic, keywords] of Object.entries(topicKeywords)) {
      if (keywords.some((kw) => lowered.includes(kw))) {
        topics.add(topic);
      }
    }

    return Array.from(topics);
  }

  /**
   * Basic entity extraction
   */
  private extractEntities(raw: string): string[] {
    const entities: Set<string> = new Set();
    const pattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g;
    const matches = raw.match(pattern);

    if (matches) {
      const commonWords = new Set([
        'The', 'This', 'That', 'I', 'We', 'They', 'It', 'He', 'She',
        'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December',
      ]);

      for (const match of matches) {
        if (!commonWords.has(match)) {
          entities.add(match);
        }
      }
    }

    return Array.from(entities);
  }
}
