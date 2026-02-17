import { Injectable } from '@nestjs/common';
import { LLMService } from '../llm/llm.service';
import { MemoryLayer, MemoryType } from '@prisma/client';

export interface FieldConfidence {
  whoConfidence: number | null;
  whatConfidence: number | null;
  whenConfidence: number | null;
  whereConfidence: number | null;
  whyConfidence: number | null;
  howConfidence: number | null;
}

export interface LessonFields {
  lessonMistake: string | null;
  lessonRootCause: string | null;
  lessonCorrectAction: string | null;
  lessonSeverity: 'low' | 'medium' | 'high' | 'critical' | null;
  lessonSource:
    | 'user_correction'
    | 'error_detection'
    | 'self_reflection'
    | 'explicit'
    | null;
  lessonTriggerPatterns: string[];
}

export interface ExtractionResult {
  who: string | null;
  what: string | null;
  when: string | null; // ISO date string or relative time
  where: string | null;
  why: string | null;
  how: string | null;
  topics: string[];
  entities: EntityWithType[];
  // Memory Intelligence: Classification
  memoryType: MemoryType | null;
  typeConfidence: number | null;
  // Field-level confidence scores
  confidence: FieldConfidence;
  // LESSON-specific fields (populated when memoryType is LESSON)
  lesson: LessonFields | null;
}

// Priority mapping for memory types
export const MEMORY_TYPE_PRIORITY: Record<MemoryType, number> = {
  CONSTRAINT: 1, // Safety-critical, highest priority
  LESSON: 1, // Mistakes and learnings, same tier as CONSTRAINT
  PREFERENCE: 2, // User preferences
  TASK: 2, // Actionable items (same as preferences)
  FACT: 3, // Stable information
  EVENT: 4, // Conversational moments, lowest priority
};

export interface EntityWithType {
  name: string;
  type:
    | 'person'
    | 'organization'
    | 'project'
    | 'product'
    | 'location'
    | 'other';
}

export interface ExtractionContext {
  userName?: string;
  userId?: string;
  timestamp?: Date;
  turnIndex?: number;
  conversationId?: string;
}

const EXTRACTION_PROMPT_TEMPLATE = (userName?: string, timestamp?: Date) => {
  const now = timestamp ?? new Date();
  const isoNow = now.toISOString();
  const humanNow = now.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });

  return `You are a memory extraction system. Given a piece of text, extract structured information using the 5W1H framework AND classify the memory type.

CURRENT TIMESTAMP: ${isoNow} (${humanNow})
Use this to resolve relative time references ("today", "yesterday", "next week", "tomorrow") into ISO dates.

${userName ? `IMPORTANT: This memory is about or from a user named "${userName}". Replace generic references like "User", "user", "the user", "I", "they" with "${userName}" in your extraction.` : ''}

Extract these fields (use these EXACT lowercase JSON keys):
- "who": People, organizations, or entities mentioned. ${userName ? `Use "${userName}" instead of generic "User" references.` : ''}
- "what": The core fact, action, or statement. Make it a complete, standalone sentence that makes sense out of context. Be specific — "prefers oat milk lattes" not "has a preference".
- "when": Any temporal context. Convert relative references ("tomorrow", "next week", "yesterday") to ISO dates using the CURRENT TIMESTAMP above. If no time is mentioned, use null (the system records createdAt automatically).
- "where": Location, platform, context, or setting. This includes physical locations ("Vancouver"), digital contexts ("in Slack", "on the repo"), or situational context ("during the meeting", "at work").
- "why": Reasoning, motivation, or cause behind the statement or action. What prompted this? Why does it matter? Even implied reasons count ("switched to dark mode" → why: "easier on the eyes" if implied).
- "how": Method, manner, or process
- "topics": Relevant categories (e.g., "preferences", "work", "technical", "personal")
- "entities": Named entities with types. Return as array of {name, type} objects where type is: person, organization, project, product, location, or other

MEMORY TYPE CLASSIFICATION (this is critical for retrieval priority):

Classify this memory into exactly ONE type:

- "CONSTRAINT": Safety-critical rules that must NEVER be violated. Allergies, medications, legal requirements, hard boundaries. Keywords often include "allergic", "can't have", "must not", "medical", "never", "always" when referring to safety. Ask: "Could violating this harm the user?"

- "PREFERENCE": Personal preferences about how things should be done. Coffee orders, UI preferences, communication styles, work habits. Ask: "Is this about what the user likes or how they want things?"

- "FACT": Stable information about the user or their world. Location, job, relationships, skills, history. Ask: "Is this something that describes who they are or their situation?"

- "TASK": Actionable items with implicit or explicit deadlines. Reminders, todos, commitments. Ask: "Is this something to be done?"

- "EVENT": Conversational moments, things that happened. Ask: "Is this about something that occurred?"

- "LESSON": A mistake, correction, or learning. The user corrected the agent, an error occurred and was resolved, or an explicit lesson was stated. Contains what went wrong, why, and what should have happened. Keywords: "that's wrong", "actually", "don't do that again", "lesson learned", "mistake", "I told you". Ask: "Is this about learning from a failure or correction?"

Important distinctions:
- "I'm allergic to peanuts" → CONSTRAINT (safety-critical)
- "I don't like peanuts" → PREFERENCE (not safety-critical)
- "I can't eat peanuts" → CONSTRAINT (assume safety unless clearly preference)
- "I prefer not to eat peanuts" → PREFERENCE (explicit preference language)
- "I ate peanuts yesterday" → EVENT (past occurrence)
- "I need a large oat milk latte every morning" → PREFERENCE (daily routine/habit)
- "Remind me to call mom" → TASK (actionable)
- "I live in Vancouver" → FACT (stable info)
- "No, you pushed WhaleHawk stuff to the Engram repo" → LESSON (user correction)
- "Remember: always check which repo you're in before committing" → LESSON (explicit lesson)
- "The deploy failed because we forgot to run migrations" → LESSON (error + learning)
- "Never deploy on Fridays" → CONSTRAINT (hard rule, not experiential)

Output these classification fields:
- "memoryType": One of: CONSTRAINT, PREFERENCE, FACT, TASK, EVENT, LESSON
- "typeConfidence": A number 0.0-1.0 indicating classification confidence

If memoryType is LESSON, also extract these fields:
- "lessonMistake": What went wrong (the error or incorrect action)
- "lessonRootCause": Why it went wrong (the underlying cause)
- "lessonCorrectAction": What should have been done instead
- "lessonSeverity": One of: "low", "medium", "high", "critical"
- "lessonSource": One of: "user_correction", "error_detection", "self_reflection", "explicit"
- "lessonTriggerPatterns": Array of strings - situations where this lesson should surface in future

FIELD CONFIDENCE SCORING:
For each 5W1H field, also provide a confidence score (0.0-1.0):
- 1.0: Explicitly stated in the text ("I live in Vancouver" → where_confidence: 1.0)
- 0.7-0.9: Strongly implied ("working from home in the Pacific timezone" → where_confidence: 0.8)
- 0.4-0.6: Inferred from context ("mentioned a meeting at Google" → where_confidence: 0.5)
- 0.1-0.3: Guessed or very uncertain

Output these additional fields:
- "who_confidence": confidence for the who field
- "what_confidence": confidence for the what field
- "when_confidence": confidence for the when field
- "where_confidence": confidence for the where field
- "why_confidence": confidence for the why field
- "how_confidence": confidence for the how field

If a 5W1H field is null, set its confidence to null too.
For topics and entities, return empty arrays if none found.

Respond with valid JSON only, using lowercase keys. No explanation.`;
};

interface ExtractionResponse {
  who: string | null;
  what: string | null;
  when: string | null;
  where: string | null;
  why: string | null;
  how: string | null;
  topics: string[];
  entities: Array<{ name: string; type: string } | string>;
  // Memory Intelligence
  memoryType: string | null;
  memorytype: string | null; // Handle case variations
  typeConfidence: number | null;
  typeconfidence: number | null; // Handle case variations
  // Field-level confidence
  who_confidence: number | null;
  what_confidence: number | null;
  when_confidence: number | null;
  where_confidence: number | null;
  why_confidence: number | null;
  how_confidence: number | null;
  // LESSON-specific fields
  lessonmistake: string | null;
  lessonrootcause: string | null;
  lessoncorrectaction: string | null;
  lessonseverity: string | null;
  lessonsource: string | null;
  lessontriggerpatterns: string[] | null;
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
  async extract(
    raw: string,
    context?: ExtractionContext,
  ): Promise<ExtractionResult> {
    const inputPreview = raw.length > 100 ? raw.substring(0, 100) + '...' : raw;

    console.log('[Extraction] Starting extraction:', {
      inputPreview,
      inputLength: raw.length,
      userName: context?.userName,
      userId: context?.userId,
    });

    try {
      const prompt = EXTRACTION_PROMPT_TEMPLATE(
        context?.userName,
        context?.timestamp,
      );

      const rawResult = await this.llm.json<Record<string, unknown>>(
        [
          { role: 'system', content: prompt },
          { role: 'user', content: `Extract from this memory:\n\n"${raw}"` },
        ],
        undefined,
        { temperature: 0.2 }, // Low temperature for consistent extraction
      );

      // Log raw LLM response keys to catch case sensitivity issues
      const rawEntities = rawResult.entities ?? rawResult.ENTITIES;
      console.log('[Extraction] Raw LLM response:', {
        keys: Object.keys(rawResult),
        hasUppercaseKeys: Object.keys(rawResult).some(
          (k) => k !== k.toLowerCase(),
        ),
        entityCount: Array.isArray(rawEntities) ? rawEntities.length : 0,
      });

      // Normalize keys to lowercase (LLM sometimes returns WHO instead of who)
      const result = this.normalizeResponseKeys(rawResult);

      // Normalize memory type (handle case variations)
      const rawMemoryType = result.memoryType || result.memorytype;
      const memoryType = this.normalizeMemoryType(rawMemoryType);
      const typeConfidence =
        result.typeConfidence ?? result.typeconfidence ?? null;

      // Parse field-level confidence scores
      const confidence: FieldConfidence = {
        whoConfidence: this.parseConfidence(result.who_confidence, result.who),
        whatConfidence: this.parseConfidence(
          result.what_confidence,
          result.what,
        ),
        whenConfidence: this.parseConfidence(
          result.when_confidence,
          result.when,
        ),
        whereConfidence: this.parseConfidence(
          result.where_confidence,
          result.where,
        ),
        whyConfidence: this.parseConfidence(result.why_confidence, result.why),
        howConfidence: this.parseConfidence(result.how_confidence, result.how),
      };

      // Parse LESSON-specific fields if applicable
      const lesson: LessonFields | null =
        memoryType === 'LESSON'
          ? {
              lessonMistake: result.lessonmistake || null,
              lessonRootCause: result.lessonrootcause || null,
              lessonCorrectAction: result.lessoncorrectaction || null,
              lessonSeverity: this.normalizeLessonSeverity(
                result.lessonseverity,
              ),
              lessonSource: this.normalizeLessonSource(result.lessonsource),
              lessonTriggerPatterns: Array.isArray(result.lessontriggerpatterns)
                ? result.lessontriggerpatterns
                : [],
            }
          : null;

      const extractionResult: ExtractionResult = {
        who: result.who || null,
        what: result.what || null,
        when: result.when || null,
        where: result.where || null,
        why: result.why || null,
        how: result.how || null,
        topics: Array.isArray(result.topics) ? result.topics : [],
        entities: this.normalizeEntities(result.entities, context?.userName),
        memoryType,
        typeConfidence:
          typeof typeConfidence === 'number' ? typeConfidence : null,
        confidence,
        lesson,
      };

      console.log('[Extraction] Extraction complete:', {
        who: extractionResult.who,
        what: extractionResult.what?.substring(0, 50),
        topicCount: extractionResult.topics.length,
        entityCount: extractionResult.entities.length,
        entities: extractionResult.entities.map((e) => `${e.name}:${e.type}`),
        memoryType: extractionResult.memoryType,
        typeConfidence: extractionResult.typeConfidence,
        confidence: extractionResult.confidence,
      });

      return extractionResult;
    } catch (error) {
      console.error('[Extraction] LLM extraction FAILED:', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        inputPreview,
        inputLength: raw.length,
        userName: context?.userName,
        userId: context?.userId,
        timestamp: new Date().toISOString(),
      });
      console.log('[Extraction] Falling back to basicExtraction');
      return this.basicExtraction(raw, context?.userName);
    }
  }

  /**
   * Parse a confidence value from LLM response
   * Returns null if the corresponding field is null (no confidence for absent data)
   */
  private parseConfidence(
    confidence: number | null | undefined,
    fieldValue: unknown,
  ): number | null {
    if (fieldValue === null || fieldValue === undefined) return null;
    if (typeof confidence !== 'number') return null;
    return Math.max(0, Math.min(1, confidence)); // Clamp to 0-1
  }

  /**
   * Normalize response keys to lowercase
   * Handles LLM returning WHO/WHAT vs who/what
   */
  private normalizeResponseKeys(
    raw: Record<string, unknown>,
  ): ExtractionResponse {
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
          ? entity.split(':').map((s) => s.trim())
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
    if (
      userName &&
      !result.some((e) => e.name.toLowerCase() === userName.toLowerCase())
    ) {
      // Check if the original text likely references this user
      // (handled by the LLM prompt, but this is a safety net)
    }

    return result;
  }

  /**
   * Validate entity type, default to 'other' if invalid
   */
  private validateEntityType(type: string): EntityWithType['type'] {
    const validTypes = [
      'person',
      'organization',
      'project',
      'product',
      'location',
      'other',
    ];
    const normalized = type?.toLowerCase().trim();
    return validTypes.includes(normalized)
      ? (normalized as EntityWithType['type'])
      : 'other';
  }

  /**
   * Normalize memory type from LLM response
   * Handles case variations and invalid values
   */
  private normalizeMemoryType(
    type: string | null | undefined,
  ): MemoryType | null {
    if (!type) return null;

    const normalized = type.toUpperCase().trim();
    const validTypes: MemoryType[] = [
      'CONSTRAINT',
      'PREFERENCE',
      'FACT',
      'TASK',
      'EVENT',
      'LESSON',
    ];

    if (validTypes.includes(normalized as MemoryType)) {
      return normalized as MemoryType;
    }

    // Handle common variations
    const mappings: Record<string, MemoryType> = {
      CONSTRAINTS: 'CONSTRAINT',
      PREFERENCES: 'PREFERENCE',
      FACTS: 'FACT',
      TASKS: 'TASK',
      EVENTS: 'EVENT',
      LESSONS: 'LESSON',
      PREF: 'PREFERENCE',
    };

    if (mappings[normalized]) {
      return mappings[normalized];
    }

    console.warn(
      '[Extraction] Unknown memory type:',
      type,
      '-> defaulting to FACT',
    );
    return 'FACT'; // Safe default
  }

  /**
   * Normalize lesson severity from LLM response
   */
  private normalizeLessonSeverity(
    severity: string | null | undefined,
  ): LessonFields['lessonSeverity'] {
    if (!severity) return null;
    const normalized = severity.toLowerCase().trim();
    const valid: LessonFields['lessonSeverity'][] = [
      'low',
      'medium',
      'high',
      'critical',
    ];
    return valid.includes(normalized as any)
      ? (normalized as LessonFields['lessonSeverity'])
      : 'medium';
  }

  /**
   * Normalize lesson source from LLM response
   */
  private normalizeLessonSource(
    source: string | null | undefined,
  ): LessonFields['lessonSource'] {
    if (!source) return null;
    const normalized = source.toLowerCase().trim().replace(/\s+/g, '_');
    const valid: LessonFields['lessonSource'][] = [
      'user_correction',
      'error_detection',
      'self_reflection',
      'explicit',
    ];
    return valid.includes(normalized as any)
      ? (normalized as LessonFields['lessonSource'])
      : 'explicit';
  }

  /**
   * Get priority number for a memory type
   */
  getPriorityForType(type: MemoryType | null): number {
    if (!type) return 3; // Default to FACT priority
    return MEMORY_TYPE_PRIORITY[type] ?? 3;
  }

  /**
   * Classify the appropriate memory layer based on content analysis
   * P5-003: Intelligent Layer Classification
   *
   * @param raw - The raw memory text
   * @param extracted - Optional extraction result for entity-based classification
   * @returns The recommended MemoryLayer
   */
  classifyLayer(raw: string, extracted?: ExtractionResult): MemoryLayer {
    const lowered = raw.toLowerCase();

    // IDENTITY patterns - persistent facts about the user
    const identityPatterns = [
      /\b(prefer|prefers|always|never|favorite|hate|hates|love|loves)\b/i,
      /\b(born|birthday|age|years? old)\b/i,
      /\b(live|lives|from|hometown|grew up)\b/i,
      /\b(name is|called|known as|go by)\b/i,
      /\b(wife|husband|spouse|daughters?|sons?|family|mother|father|parents?|siblings?|brothers?|sisters?|child|children)\b/i,
      /\b(work at|works at|job|profession|career|employed|employer|occupation)\b/i,
      /\b(allergic|allergy|allergies|intolerant|intolerance)\b/i,
      /\b(believe|believes|religion|faith)\b/i,
      /\b(hobby|hobbies|passionate about)\b/i,
      /\b(timezone|time zone|located in)\b/i,
      /\bi (am|'m) a\b/i, // "I am a developer"
      /\bmy (name|birthday|job|wife|husband|family)\b/i,
    ];

    // Check for identity patterns
    for (const pattern of identityPatterns) {
      if (pattern.test(raw)) {
        console.log(
          '[classifyLayer] Matched IDENTITY pattern:',
          pattern.toString(),
        );
        return MemoryLayer.IDENTITY;
      }
    }

    // PROJECT patterns - work/project related
    const projectPatterns = [
      /\b(project|projects)\b/i,
      /\b(building|developing|implementing|working on)\b/i,
      /\b(repo|repository|codebase|branch)\b/i,
      /\b(deadline|due date|milestone|sprint|release)\b/i,
      /\b(feature|bug|issue|ticket|pr|pull request)\b/i,
      /\b(deploy|deployment|production|staging)\b/i,
      /\b(client|customer|stakeholder)\s+(wants|needs|requested)/i,
      /\b(architecture|design doc|spec|specification)\b/i,
      /\b(team|teammate|collaborator)\b/i,
    ];

    // Check for project patterns
    for (const pattern of projectPatterns) {
      if (pattern.test(raw)) {
        console.log(
          '[classifyLayer] Matched PROJECT pattern:',
          pattern.toString(),
        );
        return MemoryLayer.PROJECT;
      }
    }

    // Additional heuristic: if entities include projects or organizations, lean toward PROJECT
    if (extracted?.entities) {
      const hasProjectEntity = extracted.entities.some(
        (e) => e.type === 'project' || e.type === 'organization',
      );
      if (hasProjectEntity) {
        console.log('[classifyLayer] Entity-based classification: PROJECT');
        return MemoryLayer.PROJECT;
      }

      // If it's about a person (not the user), could be relationship info (IDENTITY)
      const personEntities = extracted.entities.filter(
        (e) => e.type === 'person',
      );
      if (personEntities.length > 0 && extracted.who) {
        // Check if it's about family/relationships
        if (/\b(wife|husband|daughter|son|friend|colleague)\b/i.test(raw)) {
          console.log(
            '[classifyLayer] Relationship-based classification: IDENTITY',
          );
          return MemoryLayer.IDENTITY;
        }
      }
    }

    // Default to SESSION for transient/temporary memories
    console.log('[classifyLayer] Default classification: SESSION');
    return MemoryLayer.SESSION;
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

    // Basic memory type classification (fallback heuristics)
    const memoryType = this.basicMemoryTypeClassification(processedRaw);

    const who = userName || this.extractWho(processedRaw);
    const what =
      processedRaw.length > 200
        ? processedRaw.substring(0, 200) + '...'
        : processedRaw;

    return {
      who,
      what,
      when: null,
      where: null,
      why: null,
      how: null,
      topics: this.extractTopics(processedRaw),
      entities: this.extractEntitiesWithTypes(processedRaw, userName),
      memoryType,
      typeConfidence: 0.5, // Low confidence for heuristic classification
      confidence: {
        whoConfidence: who ? 0.3 : null, // Low confidence for heuristic extraction
        whatConfidence: what ? 0.4 : null, // Raw text used as-is, moderate
        whenConfidence: null,
        whereConfidence: null,
        whyConfidence: null,
        howConfidence: null,
      },
      lesson: null, // Basic extraction doesn't extract lesson fields
    };
  }

  /**
   * Basic heuristic-based memory type classification
   * Used as fallback when LLM is unavailable
   */
  private basicMemoryTypeClassification(raw: string): MemoryType {
    const lowered = raw.toLowerCase();

    // CONSTRAINT patterns (safety-critical)
    if (
      /\b(allergic|allergy|allergies|intolerant|medication|medical|deadly|fatal)\b/i.test(
        raw,
      )
    ) {
      return 'CONSTRAINT';
    }
    if (
      /\b(must not|cannot|can't|never|forbidden|prohibited)\b/i.test(raw) &&
      /\b(eat|take|use|do|have)\b/i.test(raw)
    ) {
      return 'CONSTRAINT';
    }

    // LESSON patterns (mistakes, corrections, learnings)
    if (
      /\b(that's wrong|that was wrong|you made a mistake|lesson learned|don't do that again)\b/i.test(
        raw,
      )
    ) {
      return 'LESSON';
    }
    if (
      /\b(actually|no,)\b/i.test(raw) &&
      /\b(wrong|incorrect|mistake|shouldn't have|should have)\b/i.test(raw)
    ) {
      return 'LESSON';
    }

    // TASK patterns
    if (
      /\b(remind|todo|task|need to|should|must|deadline|by tomorrow|by next)\b/i.test(
        raw,
      )
    ) {
      return 'TASK';
    }

    // PREFERENCE patterns
    if (
      /\b(prefer|prefers|favorite|favourite|like|likes|love|loves|enjoy|enjoys|want|wants)\b/i.test(
        raw,
      )
    ) {
      return 'PREFERENCE';
    }
    if (
      /\b(always|usually|normally|every morning|every day)\b/i.test(raw) &&
      !/\b(allergic|medical|cannot)\b/i.test(raw)
    ) {
      return 'PREFERENCE';
    }

    // EVENT patterns
    if (
      /\b(yesterday|today|last week|recently|just now|this morning|earlier)\b/i.test(
        raw,
      )
    ) {
      return 'EVENT';
    }

    // Default to FACT
    return 'FACT';
  }

  /**
   * Basic WHO extraction (looks for names)
   */
  private extractWho(raw: string): string | null {
    const namePattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g;
    const matches = raw.match(namePattern);

    if (matches && matches.length > 0) {
      const commonWords = new Set([
        'The',
        'This',
        'That',
        'I',
        'We',
        'They',
        'It',
        'He',
        'She',
        'Monday',
        'Tuesday',
        'Wednesday',
        'Thursday',
        'Friday',
        'Saturday',
        'Sunday',
        'January',
        'February',
        'March',
        'April',
        'May',
        'June',
        'July',
        'August',
        'September',
        'October',
        'November',
        'December',
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
      coding: [
        'code',
        'programming',
        'developer',
        'api',
        'function',
        'bug',
        'deploy',
      ],
      design: ['design', 'ui', 'ux', 'layout', 'color', 'font', 'style'],
      business: [
        'meeting',
        'client',
        'project',
        'deadline',
        'budget',
        'pricing',
      ],
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
        'The',
        'This',
        'That',
        'I',
        'We',
        'They',
        'It',
        'He',
        'She',
        'Monday',
        'Tuesday',
        'Wednesday',
        'Thursday',
        'Friday',
        'Saturday',
        'Sunday',
        'January',
        'February',
        'March',
        'April',
        'May',
        'June',
        'July',
        'August',
        'September',
        'October',
        'November',
        'December',
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
  private extractEntitiesWithTypes(
    raw: string,
    userName?: string,
  ): EntityWithType[] {
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
        'The',
        'This',
        'That',
        'I',
        'We',
        'They',
        'It',
        'He',
        'She',
        'Monday',
        'Tuesday',
        'Wednesday',
        'Thursday',
        'Friday',
        'Saturday',
        'Sunday',
        'January',
        'February',
        'March',
        'April',
        'May',
        'June',
        'July',
        'August',
        'September',
        'October',
        'November',
        'December',
        'User',
        'Assistant',
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
