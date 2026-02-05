import { Injectable } from '@nestjs/common';

export interface SafetyResult {
  isSafety: boolean;
  indicators: string[];
}

interface SafetyPattern {
  pattern: RegExp;
  indicator: string;
}

const SAFETY_PATTERNS: SafetyPattern[] = [
  { pattern: /\ballerg(y|ic|ies)\b/i, indicator: 'allergy' },
  { pattern: /\bmedication|medicine|prescription|drug\b/i, indicator: 'medication' },
  { pattern: /\bdiabet(es|ic)\b/i, indicator: 'diabetes' },
  { pattern: /\bepilepsy|seizures?\b/i, indicator: 'seizure' },
  { pattern: /\basthma|inhaler\b/i, indicator: 'asthma' },
  { pattern: /\bemergency contact\b/i, indicator: 'emergency' },
  { pattern: /\bblood type\b/i, indicator: 'medical' },
  { pattern: /\bdo not resuscitate|dnr\b/i, indicator: 'medical_directive' },
  { pattern: /\blife[- ]threatening\b/i, indicator: 'critical' },
  { pattern: /\bdeathly|fatal|deadly\b/i, indicator: 'critical' },
  { pattern: /\banaphy(laxis|lactic)\b/i, indicator: 'allergy' },
  { pattern: /\bepipen\b/i, indicator: 'allergy' },
  { pattern: /\bheart condition|cardiac\b/i, indicator: 'medical' },
  { pattern: /\bpacemaker\b/i, indicator: 'medical' },
  { pattern: /\bblood thinner|anticoagulant\b/i, indicator: 'medication' },
  { pattern: /\binsulin\b/i, indicator: 'medication' },
];

@Injectable()
export class SafetyDetectorService {
  private patterns: SafetyPattern[];

  constructor(additionalPatterns?: SafetyPattern[]) {
    this.patterns = [...SAFETY_PATTERNS, ...(additionalPatterns ?? [])];
  }

  /**
   * Detect if text contains safety-critical information
   * Returns indicators of what type of safety info was found
   */
  detectSafetyCritical(text: string): SafetyResult {
    const indicators: string[] = [];

    for (const { pattern, indicator } of this.patterns) {
      if (pattern.test(text)) {
        // Avoid duplicate indicators
        if (!indicators.includes(indicator)) {
          indicators.push(indicator);
        }
      }
    }

    return {
      isSafety: indicators.length > 0,
      indicators,
    };
  }

  /**
   * Add custom patterns at runtime
   */
  addPattern(pattern: RegExp, indicator: string): void {
    this.patterns.push({ pattern, indicator });
  }

  /**
   * Get current patterns (for debugging/testing)
   */
  getPatterns(): SafetyPattern[] {
    return [...this.patterns];
  }
}
