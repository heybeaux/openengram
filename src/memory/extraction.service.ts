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
  entities: EntityWithType[];
}

export interface EntityWithType {
  name: string;
  type: 'person' | 'organization' | 'project' | 'product' | 'location' | 'other';
}

export interface ExtractionContext {
  userName?: string;
  userId?: string;
  timestamp?: Date;
  turnIndex?: number;
  conversationId?: string;
}

const EXTRACTION_PROMPT_TEMPLATE = (userName?: string) => `You are a memory extraction system. Given a piece of text, extract structured information using the 5W1H framework.

${userName ? `IMPORTANT: This memory is about or from a user named "${userName}". Replace generic references like "User", "user", "the user", "I", "they" with "${userName}" in your extraction.` : ''}

Extract these fields (use these EXACT lowercase JSON keys):
- "who": People, organizations, or entities mentioned. ${userName ? `Use "${userName}" instead of generic "User" references.` : ''}
- "what": The core fact, action, or statement. Make it a complete, standalone sentence.
- "when": Any temporal context (dates, times, relative references). Use ISO format if possible.
- "where": Location, context, or setting
- "why": Reasoning, motivation, or cause
- "how": Method, manner, or process
- "topics": Relevant categories (e.g., "preferences", "work", "technical", "personal")
- "entities": Named entities with types. Return as array of {name, type} objects where type is: person, organization, project, product, location, or other

If a field cannot be determined from the text, set it to null.
For topics and entities, return empty arrays if none found.

Respond with valid JSON only, using lowercase keys. No explanation.`;

interface ExtractionResponse {
  who: string | null;
  what: string | null;
  when: string | null;
  where: string | null;
  why: string | null;
  how: string | null;
  topics: string[];
  entities: Array<{ name: string; type: string } | string>;
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
   * @param raw - The raw memory text to extract from
   * @param context - Optional context including user name for better extraction
   */
  async extract(raw: string, context?: ExtractionContext): Promise<ExtractionResult> {
    try {
      const prompt = EXTRACTION_PROMPT_TEMPLATE(context?.userName);
      
      const rawResult = await this.llm.json<Record<string, unknown>>(
        [
          { role: 'system', content: prompt },
          { role: 'user', content: `Extract from this memory:\n\n"${raw}"` },
        ],
        undefined,
        { temperature: 0.2 }, // Low temperature for consistent extraction
      );

      // Normalize keys to lowercase (LLM sometimes returns WHO instead of who)
      const result = this.normalizeResponseKeys(rawResult);

      return {
        who: result.who || null,
        what: result.what || null,
        when: result.when || null,
        where: result.where || null,
        why: result.why || null,
        how: result.how || null,
        topics: Array.isArray(result.topics) ? result.topics : [],
        entities: this.normalizeEntities(result.entities, context?.userName),
      };
    } catch (error) {
      console.error('[ExtractionService] LLM extraction failed:', {
        error: error instanceof Error ? error.message : String(error),
        rawPreview: raw.substring(0, 100),
        userName: context?.userName,
      });
      return this.basicExtraction(raw, context?.userName);
    }
  }

  /**
   * Normalize response keys to lowercase
   * Handles LLM returning WHO/WHAT vs who/what
   */
  private normalizeResponseKeys(raw: Record<string, unknown>): ExtractionResponse {
    const normalized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw)) {
      normalized[key.toLowerCase()] = value;
    }
    return normalized as unknown as ExtractionResponse;
  }

  /**
   * Normalize entities from LLM response to EntityWithType format
   * Handles both string[] and {name, type}[] responses
   */
  private normalizeEntities(
    entities: Array<{ name: string; type: string } | string> | undefined,
    userName?: string,
  ): EntityWithType[] {
    if (!entities || !Array.isArray(entities)) return [];

    const result: EntityWithType[] = [];

    for (const entity of entities) {
      if (typeof entity === 'string') {
        // Legacy format: "Name:type" or just "Name"
        const [name, type] = entity.includes(':') 
          ? entity.split(':').map(s => s.trim())
          : [entity, 'other'];
        result.push({
          name,
          type: this.validateEntityType(type),
        });
      } else if (entity && typeof entity === 'object' && entity.name) {
        result.push({
          name: entity.name,
          type: this.validateEntityType(entity.type),
        });
      }
    }

    // If userName provided, ensure they're included as a person entity
    if (userName && !result.some(e => e.name.toLowerCase() === userName.toLowerCase())) {
      // Check if the original text likely references this user
      // (handled by the LLM prompt, but this is a safety net)
    }

    return result;
  }

  /**
   * Validate entity type, default to 'other' if invalid
   */
  private validateEntityType(type: string): EntityWithType['type'] {
    const validTypes = ['person', 'organization', 'project', 'product', 'location', 'other'];
    const normalized = type?.toLowerCase().trim();
    return validTypes.includes(normalized) ? normalized as EntityWithType['type'] : 'other';
  }

  /**
   * Fallback basic extraction when LLM is unavailable
   */
  private basicExtraction(raw: string, userName?: string): ExtractionResult {
    // Replace "User" with actual name if provided
    let processedRaw = raw;
    if (userName) {
      processedRaw = raw
        .replace(/\bUser\b/g, userName)
        .replace(/\buser\b/g, userName)
        .replace(/\bthe user\b/gi, userName);
    }

    return {
      who: userName || this.extractWho(processedRaw),
      what: processedRaw.length > 200 ? processedRaw.substring(0, 200) + '...' : processedRaw,
      when: null,
      where: null,
      why: null,
      how: null,
      topics: this.extractTopics(processedRaw),
      entities: this.extractEntitiesWithTypes(processedRaw, userName),
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
   * Basic entity extraction (returns string array - legacy)
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

  /**
   * Basic entity extraction with type inference
   */
  private extractEntitiesWithTypes(raw: string, userName?: string): EntityWithType[] {
    const entities: EntityWithType[] = [];
    const seen = new Set<string>();

    // If we have a userName, add them as a person
    if (userName && !seen.has(userName.toLowerCase())) {
      entities.push({ name: userName, type: 'person' });
      seen.add(userName.toLowerCase());
    }

    // Extract capitalized names
    const pattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g;
    const matches = raw.match(pattern);

    if (matches) {
      const commonWords = new Set([
        'The', 'This', 'That', 'I', 'We', 'They', 'It', 'He', 'She',
        'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December',
        'User', 'Assistant',
      ]);

      for (const match of matches) {
        const normalized = match.toLowerCase();
        if (!commonWords.has(match) && !seen.has(normalized)) {
          // Simple heuristic for type detection
          let type: EntityWithType['type'] = 'other';
          
          // Two-word names are likely people
          if (match.includes(' ') && match.split(' ').length === 2) {
            type = 'person';
          }
          // Single capitalized word - could be many things
          else if (/^[A-Z][a-z]+$/.test(match)) {
            type = 'other'; // Conservative default
          }

          entities.push({ name: match, type });
          seen.add(normalized);
        }
      }
    }

    return entities;
  }
}
