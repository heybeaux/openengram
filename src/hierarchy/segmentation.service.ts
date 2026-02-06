import { Injectable } from '@nestjs/common';

/**
 * Represents a sentence unit extracted from text
 */
export interface SentenceUnit {
  text: string;
  position: number;      // Order in source
  charStart: number;     // Character offset start
  charEnd: number;       // Character offset end
}

/**
 * Represents a paragraph unit (grouped sentences)
 */
export interface ParagraphUnit {
  text: string;
  sentences: SentenceUnit[];
  position: number;      // Order in source
  charStart: number;     // Character offset start
  charEnd: number;       // Character offset end
}

/**
 * Segmentation Service
 * 
 * Handles text segmentation into sentences and paragraphs for hierarchical embedding.
 * 
 * Design decisions:
 * - Sentences under 20 chars are merged with neighbors
 * - Sentences over 512 chars are split at clause boundaries
 * - Code blocks and structured data are kept as atomic units
 * - Paragraphs are 2-5 sentences grouped by topic proximity
 */
@Injectable()
export class SegmentationService {
  // Minimum sentence length before merging with neighbor
  private readonly MIN_SENTENCE_LENGTH = 20;
  
  // Maximum sentence length before splitting
  private readonly MAX_SENTENCE_LENGTH = 512;
  
  // Target sentences per paragraph
  private readonly MIN_SENTENCES_PER_PARAGRAPH = 2;
  private readonly MAX_SENTENCES_PER_PARAGRAPH = 5;
  
  // Maximum words per paragraph
  private readonly MAX_WORDS_PER_PARAGRAPH = 300;

  /**
   * Extract sentences from text
   * 
   * Algorithm:
   * 1. Preserve code blocks as atomic units
   * 2. Split on sentence boundaries (. ! ? with space or end)
   * 3. Merge short sentences with neighbors
   * 4. Split long sentences at clause boundaries
   */
  extractSentences(text: string): SentenceUnit[] {
    if (!text || text.trim().length === 0) {
      return [];
    }

    // Step 1: Extract and preserve code blocks
    const { processedText, codeBlocks } = this.extractCodeBlocks(text);
    
    // Step 2: Split on sentence boundaries
    const rawSentences = this.splitOnSentenceBoundaries(processedText);
    
    // Step 3: Restore code blocks and create sentence units
    const sentencesWithBlocks = this.restoreCodeBlocks(rawSentences, codeBlocks);
    
    // Step 4: Merge short sentences
    const mergedSentences = this.mergeShortSentences(sentencesWithBlocks);
    
    // Step 5: Split long sentences
    const finalSentences = this.splitLongSentences(mergedSentences);
    
    // Step 6: Calculate character offsets
    return this.calculateOffsets(finalSentences, text);
  }

  /**
   * Extract paragraphs from text
   * 
   * Algorithm:
   * 1. Extract sentences first
   * 2. Group sentences by natural paragraph breaks (double newline)
   * 3. Further split groups that are too long
   * 4. Merge groups that are too short
   */
  extractParagraphs(text: string): ParagraphUnit[] {
    if (!text || text.trim().length === 0) {
      return [];
    }

    // First, try to split by natural paragraph breaks (double newline)
    const naturalParagraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
    
    if (naturalParagraphs.length > 1) {
      // Text has natural paragraph structure
      return this.processParagraphsFromNaturalBreaks(naturalParagraphs, text);
    }
    
    // No natural breaks - group sentences into paragraphs
    const sentences = this.extractSentences(text);
    return this.groupSentencesIntoParagraphs(sentences, text);
  }

  /**
   * Process paragraphs that were split by natural breaks
   */
  private processParagraphsFromNaturalBreaks(
    paragraphs: string[],
    originalText: string,
  ): ParagraphUnit[] {
    const result: ParagraphUnit[] = [];
    let currentPosition = 0;

    for (let i = 0; i < paragraphs.length; i++) {
      const paraText = paragraphs[i].trim();
      
      // Find this paragraph's position in original text
      const charStart = originalText.indexOf(paraText, currentPosition);
      const charEnd = charStart + paraText.length;
      
      // Extract sentences within this paragraph
      const sentences = this.extractSentences(paraText);
      
      // Adjust sentence offsets to be relative to original text
      const adjustedSentences = sentences.map(s => ({
        ...s,
        charStart: charStart + s.charStart,
        charEnd: charStart + s.charEnd,
      }));
      
      // Check if paragraph is too long and needs splitting
      const wordCount = paraText.split(/\s+/).length;
      
      if (wordCount > this.MAX_WORDS_PER_PARAGRAPH && adjustedSentences.length > this.MAX_SENTENCES_PER_PARAGRAPH) {
        // Split into multiple paragraphs
        const subParagraphs = this.splitLargeParagraph(adjustedSentences, paraText, charStart);
        result.push(...subParagraphs);
      } else {
        result.push({
          text: paraText,
          sentences: adjustedSentences,
          position: result.length,
          charStart,
          charEnd,
        });
      }
      
      currentPosition = charEnd;
    }

    // Renumber positions
    return result.map((p, i) => ({ ...p, position: i }));
  }

  /**
   * Group sentences into paragraphs when no natural breaks exist
   */
  private groupSentencesIntoParagraphs(
    sentences: SentenceUnit[],
    originalText: string,
  ): ParagraphUnit[] {
    if (sentences.length === 0) {
      return [];
    }

    if (sentences.length <= this.MAX_SENTENCES_PER_PARAGRAPH) {
      // All sentences fit in one paragraph
      return [{
        text: sentences.map(s => s.text).join(' '),
        sentences,
        position: 0,
        charStart: sentences[0].charStart,
        charEnd: sentences[sentences.length - 1].charEnd,
      }];
    }

    const paragraphs: ParagraphUnit[] = [];
    let currentSentences: SentenceUnit[] = [];
    let currentWordCount = 0;

    for (const sentence of sentences) {
      const sentenceWordCount = sentence.text.split(/\s+/).length;
      
      // Check if adding this sentence would exceed limits
      const wouldExceedSentences = currentSentences.length >= this.MAX_SENTENCES_PER_PARAGRAPH;
      const wouldExceedWords = currentWordCount + sentenceWordCount > this.MAX_WORDS_PER_PARAGRAPH;
      
      if (currentSentences.length > 0 && (wouldExceedSentences || wouldExceedWords)) {
        // Finalize current paragraph
        paragraphs.push({
          text: currentSentences.map(s => s.text).join(' '),
          sentences: currentSentences,
          position: paragraphs.length,
          charStart: currentSentences[0].charStart,
          charEnd: currentSentences[currentSentences.length - 1].charEnd,
        });
        
        currentSentences = [];
        currentWordCount = 0;
      }
      
      currentSentences.push(sentence);
      currentWordCount += sentenceWordCount;
    }
    
    // Don't forget the last paragraph
    if (currentSentences.length > 0) {
      paragraphs.push({
        text: currentSentences.map(s => s.text).join(' '),
        sentences: currentSentences,
        position: paragraphs.length,
        charStart: currentSentences[0].charStart,
        charEnd: currentSentences[currentSentences.length - 1].charEnd,
      });
    }

    return paragraphs;
  }

  /**
   * Split a paragraph that's too large into smaller ones
   */
  private splitLargeParagraph(
    sentences: SentenceUnit[],
    _text: string,
    _baseOffset: number,
  ): ParagraphUnit[] {
    return this.groupSentencesIntoParagraphs(sentences, '');
  }

  /**
   * Extract code blocks and replace with placeholders
   */
  private extractCodeBlocks(text: string): { processedText: string; codeBlocks: Map<string, string> } {
    const codeBlocks = new Map<string, string>();
    let processedText = text;
    let blockIndex = 0;

    // Match fenced code blocks (```...```)
    const fencedBlockRegex = /```[\s\S]*?```/g;
    processedText = processedText.replace(fencedBlockRegex, (match) => {
      const placeholder = `__CODE_BLOCK_${blockIndex}__`;
      codeBlocks.set(placeholder, match);
      blockIndex++;
      return placeholder;
    });

    // Match inline code (`...`)
    const inlineCodeRegex = /`[^`]+`/g;
    processedText = processedText.replace(inlineCodeRegex, (match) => {
      const placeholder = `__INLINE_CODE_${blockIndex}__`;
      codeBlocks.set(placeholder, match);
      blockIndex++;
      return placeholder;
    });

    return { processedText, codeBlocks };
  }

  /**
   * Restore code blocks from placeholders
   */
  private restoreCodeBlocks(sentences: string[], codeBlocks: Map<string, string>): string[] {
    return sentences.map(sentence => {
      let restored = sentence;
      for (const [placeholder, code] of codeBlocks) {
        restored = restored.replace(placeholder, code);
      }
      return restored;
    });
  }

  /**
   * Split text on sentence boundaries
   */
  private splitOnSentenceBoundaries(text: string): string[] {
    // Pattern: sentence-ending punctuation followed by space or end
    // Handles common abbreviations by requiring capital letter after period
    const sentences: string[] = [];
    
    // More sophisticated sentence splitting that handles:
    // - Standard sentence endings (. ! ?)
    // - Abbreviations (Mr., Dr., etc.)
    // - Decimal numbers (3.14)
    // - URLs and emails
    
    // Simple regex-based splitting with common edge case handling
    const regex = /[^.!?]*(?:[.!?](?=\s+[A-Z]|$)|[.!?](?=\s*$)|[.!?](?=\s*["'\)\]]))+/g;
    let match;
    let lastEnd = 0;
    
    // Fallback: if regex doesn't work well, split on basic sentence boundaries
    const basicSplit = text.split(/(?<=[.!?])\s+(?=[A-Z])/);
    
    if (basicSplit.length > 1) {
      return basicSplit.map(s => s.trim()).filter(s => s.length > 0);
    }
    
    // If no sentence boundaries found, treat whole text as one sentence
    const trimmed = text.trim();
    if (trimmed.length > 0) {
      return [trimmed];
    }
    
    return [];
  }

  /**
   * Merge sentences that are too short
   */
  private mergeShortSentences(sentences: string[]): string[] {
    if (sentences.length <= 1) {
      return sentences;
    }

    const merged: string[] = [];
    let current = sentences[0];

    for (let i = 1; i < sentences.length; i++) {
      if (current.length < this.MIN_SENTENCE_LENGTH) {
        // Merge with next sentence
        current = current + ' ' + sentences[i];
      } else {
        merged.push(current);
        current = sentences[i];
      }
    }
    
    // Handle last sentence
    if (current.length < this.MIN_SENTENCE_LENGTH && merged.length > 0) {
      // Merge with previous
      merged[merged.length - 1] = merged[merged.length - 1] + ' ' + current;
    } else {
      merged.push(current);
    }

    return merged;
  }

  /**
   * Split sentences that are too long at clause boundaries
   */
  private splitLongSentences(sentences: string[]): string[] {
    const result: string[] = [];

    for (const sentence of sentences) {
      if (sentence.length <= this.MAX_SENTENCE_LENGTH) {
        result.push(sentence);
        continue;
      }

      // Try to split at clause boundaries: semicolons, dashes, commas
      const clauseBoundaries = ['; ', ' - ', ', '];
      let split = false;

      for (const boundary of clauseBoundaries) {
        if (sentence.includes(boundary)) {
          const parts = sentence.split(boundary);
          let current = '';
          
          for (const part of parts) {
            if (current.length === 0) {
              current = part;
            } else if ((current + boundary + part).length <= this.MAX_SENTENCE_LENGTH) {
              current = current + boundary + part;
            } else {
              result.push(current.trim());
              current = part;
            }
          }
          
          if (current.trim().length > 0) {
            result.push(current.trim());
          }
          
          split = true;
          break;
        }
      }

      if (!split) {
        // Can't split nicely, just add as-is
        result.push(sentence);
      }
    }

    return result;
  }

  /**
   * Calculate character offsets for sentences within original text
   */
  private calculateOffsets(sentences: string[], originalText: string): SentenceUnit[] {
    const units: SentenceUnit[] = [];
    let searchStart = 0;

    for (let i = 0; i < sentences.length; i++) {
      const text = sentences[i].trim();
      
      // Find this sentence in the original text
      let charStart = originalText.indexOf(text, searchStart);
      
      // If exact match not found, try to find approximate location
      if (charStart === -1) {
        // Try finding first few words
        const firstWords = text.split(/\s+/).slice(0, 3).join(' ');
        charStart = originalText.indexOf(firstWords, searchStart);
        if (charStart === -1) {
          charStart = searchStart;
        }
      }
      
      const charEnd = charStart + text.length;
      
      units.push({
        text,
        position: i,
        charStart,
        charEnd,
      });
      
      searchStart = charEnd;
    }

    return units;
  }
}
