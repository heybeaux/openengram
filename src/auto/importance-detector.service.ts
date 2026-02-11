import { Injectable } from '@nestjs/common';
import {
  MessageTurnDto,
  MessageRole,
  ImportanceSignal,
} from './dto/observe.dto';

/**
 * Detects importance signals in conversation turns
 *
 * Signals detected:
 * - Explicit: "remember this", "important", "never forget"
 * - Corrections: "actually", "no that's wrong", "I meant"
 * - Preferences: "I prefer", "I always", "I never", "I like", "I hate"
 * - Repetition: same concept mentioned multiple times
 */
@Injectable()
export class ImportanceDetectorService {
  // Explicit importance markers
  private readonly explicitPatterns: RegExp[] = [
    /\bremember\s+this\b/i,
    /\bdon'?t\s+forget\b/i,
    /\bnever\s+forget\b/i,
    /\bimportant\s*[:!]/i,
    /\bthis\s+is\s+important\b/i,
    /\bkeep\s+in\s+mind\b/i,
    /\bnote\s+that\b/i,
    /\bmake\s+sure\s+(to\s+)?remember\b/i,
    /\balways\s+remember\b/i,
    /\bcritical\s*[:!]/i,
    /\bfyi\b/i,
    /\bheads\s*up\b/i,
  ];

  // Correction patterns
  private readonly correctionPatterns: RegExp[] = [
    /\bactually\b/i,
    /\bno,?\s+that'?s?\s+(not\s+)?(wrong|right|correct)\b/i,
    /\bi\s+meant\b/i,
    /\bi\s+mean\b/i,
    /\blet\s+me\s+correct\b/i,
    /\bcorrection\s*[:!]?\b/i,
    /\bto\s+be\s+clear\b/i,
    /\bto\s+clarify\b/i,
    /\bwhat\s+i\s+(really\s+)?meant\b/i,
    /\bi\s+should\s+have\s+said\b/i,
    /\bsorry,?\s+i\s+meant\b/i,
    /\bthat'?s?\s+not\s+what\s+i\s+(meant|said)\b/i,
  ];

  // Preference patterns
  private readonly preferencePatterns: RegExp[] = [
    /\bi\s+prefer\b/i,
    /\bi\s+always\b/i,
    /\bi\s+never\b/i,
    /\bi\s+like\b/i,
    /\bi\s+love\b/i,
    /\bi\s+hate\b/i,
    /\bi\s+don'?t\s+like\b/i,
    /\bi\s+can'?t\s+stand\b/i,
    /\bmy\s+favorite\b/i,
    /\bi\s+usually\b/i,
    /\bi\s+tend\s+to\b/i,
    /\bi'?m\s+allergic\s+to\b/i,
    /\bi\s+avoid\b/i,
    /\bmy\s+go-?to\b/i,
    /\bi\s+use\s+\w+\s+(for|when)\b/i,
  ];

  /**
   * Detect all importance signals in a conversation
   */
  detect(turns: MessageTurnDto[]): ImportanceSignal[] {
    const signals: ImportanceSignal[] = [];

    // Guard against undefined or null turns
    if (!turns || !Array.isArray(turns)) {
      return signals;
    }

    // Check each turn for explicit, correction, and preference signals
    for (let i = 0; i < turns.length; i++) {
      const turn = turns[i];

      // Check explicit patterns
      signals.push(
        ...this.matchPatterns(
          turn.content,
          i,
          this.explicitPatterns,
          'explicit',
        ),
      );

      // Check correction patterns
      signals.push(
        ...this.matchPatterns(
          turn.content,
          i,
          this.correctionPatterns,
          'correction',
        ),
      );

      // Check preference patterns (only from user)
      if (turn.role === MessageRole.USER) {
        signals.push(
          ...this.matchPatterns(
            turn.content,
            i,
            this.preferencePatterns,
            'preference',
          ),
        );
      }
    }

    // Detect repetition across turns
    signals.push(...this.detectRepetition(turns));

    return signals;
  }

  /**
   * Match patterns and create signals
   */
  private matchPatterns(
    content: string,
    turnIndex: number,
    patterns: RegExp[],
    type: ImportanceSignal['type'],
  ): ImportanceSignal[] {
    const signals: ImportanceSignal[] = [];

    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match) {
        signals.push({
          type,
          trigger: match[0],
          content: this.extractContext(content, match.index!, match[0].length),
          turnIndex,
          confidence: this.calculateConfidence(type, content, match[0]),
        });
        break; // One signal per type per turn
      }
    }

    return signals;
  }

  /**
   * Extract context around the matched pattern
   */
  private extractContext(
    content: string,
    matchIndex: number,
    matchLength: number,
  ): string {
    // Get the sentence containing the match
    const sentences = content.split(/[.!?]+/);
    let charCount = 0;

    for (const sentence of sentences) {
      const sentenceEnd = charCount + sentence.length;
      if (matchIndex >= charCount && matchIndex < sentenceEnd) {
        return sentence.trim();
      }
      charCount = sentenceEnd + 1; // +1 for the punctuation
    }

    // Fallback: return surrounding context
    const start = Math.max(0, matchIndex - 50);
    const end = Math.min(content.length, matchIndex + matchLength + 100);
    return content.slice(start, end).trim();
  }

  /**
   * Calculate confidence score for a signal
   */
  private calculateConfidence(
    type: ImportanceSignal['type'],
    content: string,
    trigger: string,
  ): number {
    let confidence = 0.7; // Base confidence

    // Boost for explicit signals
    if (type === 'explicit') {
      confidence = 0.9;
      if (/never\s+forget|critical/i.test(trigger)) {
        confidence = 0.95;
      }
    }

    // Corrections are highly important
    if (type === 'correction') {
      confidence = 0.85;
    }

    // Preferences vary
    if (type === 'preference') {
      confidence = 0.75;
      if (/always|never|hate|love/i.test(trigger)) {
        confidence = 0.85;
      }
    }

    // Short content is less reliable
    if (content.length < 20) {
      confidence *= 0.8;
    }

    return Math.min(confidence, 1.0);
  }

  /**
   * Detect repeated concepts across turns
   */
  private detectRepetition(turns: MessageTurnDto[]): ImportanceSignal[] {
    const signals: ImportanceSignal[] = [];

    // Guard against undefined turns
    if (!turns || !Array.isArray(turns)) {
      return signals;
    }

    const conceptCounts = new Map<
      string,
      { count: number; indices: number[] }
    >();

    // Extract key concepts from each turn
    for (let i = 0; i < turns.length; i++) {
      const turn = turns[i];
      if (turn.role !== MessageRole.USER) continue;

      const concepts = this.extractConcepts(turn.content);
      for (const concept of concepts) {
        const normalized = concept.toLowerCase();
        const existing = conceptCounts.get(normalized);
        if (existing) {
          existing.count++;
          existing.indices.push(i);
        } else {
          conceptCounts.set(normalized, { count: 1, indices: [i] });
        }
      }
    }

    // Create signals for repeated concepts
    for (const [concept, data] of conceptCounts.entries()) {
      if (data.count >= 2) {
        signals.push({
          type: 'repetition',
          trigger: `mentioned ${data.count} times`,
          content: concept,
          turnIndex: data.indices[data.indices.length - 1], // Last occurrence
          confidence: Math.min(0.6 + data.count * 0.1, 0.9),
        });
      }
    }

    return signals;
  }

  /**
   * Extract key concepts/noun phrases from text
   */
  private extractConcepts(content: string): string[] {
    const concepts: string[] = [];

    // Extract quoted phrases
    const quoted = content.match(/"[^"]+"|'[^']+'/g);
    if (quoted) {
      concepts.push(...quoted.map((q) => q.slice(1, -1)));
    }

    // Extract capitalized phrases (potential entities)
    const capitalized = content.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g);
    if (capitalized) {
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
        'Also',
        'Please',
        'Thanks',
        'However',
        'Therefore',
        'Thus',
      ]);
      concepts.push(...capitalized.filter((c) => !commonWords.has(c)));
    }

    // Extract technical terms (e.g., API_KEY, userId, dark-mode)
    const technical = content.match(/\b[a-z]+[-_][a-z]+\b/gi);
    if (technical) {
      concepts.push(...technical);
    }

    return concepts;
  }

  /**
   * Calculate aggregate importance score from signals
   */
  calculateImportance(signals: ImportanceSignal[]): number {
    if (signals.length === 0) return 0.3; // Base importance

    // Weight by signal type
    const weights: Record<ImportanceSignal['type'], number> = {
      explicit: 0.4,
      correction: 0.35,
      preference: 0.25,
      repetition: 0.2,
    };

    let totalWeight = 0;
    let weightedSum = 0;

    for (const signal of signals) {
      const weight = weights[signal.type];
      totalWeight += weight;
      weightedSum += signal.confidence * weight;
    }

    // Normalize and boost for multiple signals
    const baseScore = totalWeight > 0 ? weightedSum / totalWeight : 0.3;
    const multiSignalBoost = Math.min(signals.length * 0.05, 0.2);

    return Math.min(baseScore + multiSignalBoost, 1.0);
  }
}
