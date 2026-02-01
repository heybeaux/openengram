import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface ExtractionResult {
  who: string | null;
  what: string | null;
  when: Date | null;
  where: string | null;
  why: string | null;
  how: string | null;
  topics: string[];
  entities: string[];
}

/**
 * Extracts structured 5W1H data from raw memory text
 * Uses LLM for extraction
 */
@Injectable()
export class ExtractionService {
  constructor(private config: ConfigService) {}

  /**
   * Extract 5W1H structure from raw text
   * 
   * In production, this would call an LLM (Claude, GPT-4, etc.)
   * For now, returns a stub implementation
   */
  async extract(raw: string): Promise<ExtractionResult> {
    // TODO: Implement LLM-based extraction
    // 
    // Prompt structure:
    // "Extract the following from this memory:
    //  - WHO: People or entities involved
    //  - WHAT: The core fact or action
    //  - WHEN: Temporal context if mentioned
    //  - WHERE: Location or context
    //  - WHY: Reasoning or motivation
    //  - HOW: Method or manner
    //  - TOPICS: Relevant topic categories
    //  - ENTITIES: Named entities (people, orgs, products)
    // 
    // Memory: ${raw}
    // 
    // Return JSON."

    // Stub implementation with basic extraction
    const result: ExtractionResult = {
      who: this.extractWho(raw),
      what: raw.length > 100 ? raw.substring(0, 100) + '...' : raw,
      when: null,
      where: null,
      why: null,
      how: null,
      topics: this.extractTopics(raw),
      entities: this.extractEntities(raw),
    };

    return result;
  }

  /**
   * Basic WHO extraction (looks for names)
   */
  private extractWho(raw: string): string | null {
    // Very basic: look for capitalized words that might be names
    const namePattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g;
    const matches = raw.match(namePattern);
    
    if (matches && matches.length > 0) {
      // Filter out common words that start with capitals
      const commonWords = new Set(['The', 'This', 'That', 'I', 'We', 'They']);
      const names = matches.filter(m => !commonWords.has(m));
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

    // Simple keyword matching for common topics
    const topicKeywords: Record<string, string[]> = {
      coding: ['code', 'programming', 'developer', 'api', 'function', 'bug', 'deploy'],
      design: ['design', 'ui', 'ux', 'layout', 'color', 'font', 'style'],
      business: ['meeting', 'client', 'project', 'deadline', 'budget', 'pricing'],
      personal: ['prefer', 'like', 'hate', 'favorite', 'always', 'never'],
      technical: ['database', 'server', 'api', 'integration', 'architecture'],
    };

    for (const [topic, keywords] of Object.entries(topicKeywords)) {
      if (keywords.some(kw => lowered.includes(kw))) {
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
    
    // Extract capitalized proper nouns
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
