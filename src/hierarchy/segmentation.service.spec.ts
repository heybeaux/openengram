import { Test, TestingModule } from '@nestjs/testing';
import { SegmentationService, SentenceUnit, ParagraphUnit } from './segmentation.service';

describe('SegmentationService', () => {
  let service: SegmentationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SegmentationService],
    }).compile();

    service = module.get<SegmentationService>(SegmentationService);
  });

  describe('extractSentences', () => {
    it('should extract simple sentences', () => {
      const text = 'This is the first sentence. This is the second sentence. This is the third sentence.';
      const sentences = service.extractSentences(text);
      
      expect(sentences.length).toBe(3);
      expect(sentences[0].text).toBe('This is the first sentence.');
      expect(sentences[1].text).toBe('This is the second sentence.');
      expect(sentences[2].text).toBe('This is the third sentence.');
    });

    it('should handle single sentence', () => {
      const text = 'This is a single sentence without any periods at the end';
      const sentences = service.extractSentences(text);
      
      expect(sentences.length).toBe(1);
      expect(sentences[0].text).toBe(text);
    });

    it('should return empty array for empty input', () => {
      expect(service.extractSentences('')).toEqual([]);
      expect(service.extractSentences('   ')).toEqual([]);
    });

    it('should preserve code blocks as atomic units', () => {
      const text = 'Here is some code. ```javascript\nconst x = 1;\nconst y = 2;\n``` And this is after.';
      const sentences = service.extractSentences(text);
      
      // Code block should be preserved
      const hasCodeBlock = sentences.some(s => s.text.includes('```'));
      expect(hasCodeBlock).toBe(true);
    });

    it('should handle inline code', () => {
      const text = 'Use the `console.log()` function to debug. It works well.';
      const sentences = service.extractSentences(text);
      
      const hasInlineCode = sentences.some(s => s.text.includes('`console.log()`'));
      expect(hasInlineCode).toBe(true);
    });

    it('should calculate correct character offsets', () => {
      const text = 'This is the first sentence. This is the second sentence.';
      const sentences = service.extractSentences(text);
      
      // All sentences should have defined offsets
      sentences.forEach(s => {
        expect(s.charStart).toBeDefined();
        expect(s.charEnd).toBeDefined();
        expect(s.charEnd).toBeGreaterThan(s.charStart);
      });
      
      // First sentence should start at 0
      expect(sentences[0].charStart).toBe(0);
    });

    it('should number sentences with position', () => {
      const text = 'This is sentence one. This is sentence two. This is sentence three.';
      const sentences = service.extractSentences(text);
      
      // Should have sequential positions starting from 0
      sentences.forEach((s, i) => {
        expect(s.position).toBe(i);
      });
    });

    it('should handle question and exclamation marks', () => {
      const text = 'Is this a question? Yes! And this is a statement.';
      const sentences = service.extractSentences(text);
      
      expect(sentences.length).toBeGreaterThanOrEqual(2);
      expect(sentences.some(s => s.text.includes('?'))).toBe(true);
      expect(sentences.some(s => s.text.includes('!'))).toBe(true);
    });

    it('should merge very short sentences with neighbors', () => {
      const text = 'OK. Fine. This is a much longer sentence that should stand alone.';
      const sentences = service.extractSentences(text);
      
      // "OK" and "Fine" are under 20 chars, should be merged
      expect(sentences.length).toBeLessThan(3);
    });
  });

  describe('extractParagraphs', () => {
    it('should extract paragraphs from text with natural breaks', () => {
      const text = `First paragraph with some content.

Second paragraph with more content.

Third paragraph with final content.`;
      
      const paragraphs = service.extractParagraphs(text);
      
      expect(paragraphs.length).toBe(3);
      expect(paragraphs[0].text).toContain('First paragraph');
      expect(paragraphs[1].text).toContain('Second paragraph');
      expect(paragraphs[2].text).toContain('Third paragraph');
    });

    it('should group sentences into paragraphs when no natural breaks', () => {
      // Create a text with many sentences (enough to require splitting)
      const sentences: string[] = [];
      for (let i = 1; i <= 20; i++) {
        sentences.push(`This is sentence number ${i} with some more content.`);
      }
      const text = sentences.join(' ');
      
      const paragraphs = service.extractParagraphs(text);
      
      // Should create paragraphs (might be 1 if text is short enough)
      expect(paragraphs.length).toBeGreaterThan(0);
      paragraphs.forEach(p => {
        expect(p.sentences.length).toBeLessThanOrEqual(5);
        expect(p.sentences.length).toBeGreaterThanOrEqual(1);
      });
    });

    it('should return empty array for empty input', () => {
      expect(service.extractParagraphs('')).toEqual([]);
      expect(service.extractParagraphs('   ')).toEqual([]);
    });

    it('should handle single paragraph content', () => {
      const text = 'This is a single paragraph. It has multiple sentences. But no breaks.';
      
      const paragraphs = service.extractParagraphs(text);
      
      expect(paragraphs.length).toBe(1);
      expect(paragraphs[0].sentences.length).toBeGreaterThanOrEqual(1);
    });

    it('should include sentences within paragraphs', () => {
      const text = `First paragraph sentence one. First paragraph sentence two.

Second paragraph sentence one. Second paragraph sentence two.`;
      
      const paragraphs = service.extractParagraphs(text);
      
      expect(paragraphs.length).toBe(2);
      expect(paragraphs[0].sentences.length).toBeGreaterThanOrEqual(1);
      expect(paragraphs[1].sentences.length).toBeGreaterThanOrEqual(1);
    });

    it('should calculate correct character offsets for paragraphs', () => {
      const text = `First paragraph.

Second paragraph.`;
      
      const paragraphs = service.extractParagraphs(text);
      
      expect(paragraphs[0].charStart).toBeDefined();
      expect(paragraphs[0].charEnd).toBeGreaterThan(paragraphs[0].charStart);
      expect(paragraphs[1].charStart).toBeGreaterThan(paragraphs[0].charEnd);
    });

    it('should number paragraphs with position', () => {
      const text = `One.

Two.

Three.`;
      
      const paragraphs = service.extractParagraphs(text);
      
      expect(paragraphs[0].position).toBe(0);
      expect(paragraphs[1].position).toBe(1);
      expect(paragraphs[2].position).toBe(2);
    });
  });

  describe('edge cases', () => {
    it('should handle text with only whitespace between sentences', () => {
      const text = 'Sentence one.     Sentence two.';
      const sentences = service.extractSentences(text);
      
      expect(sentences.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle text with tabs and newlines', () => {
      const text = 'Sentence one.\t\nSentence two.';
      const sentences = service.extractSentences(text);
      
      expect(sentences.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle Unicode content', () => {
      const text = 'Hello 世界. Bonjour le monde. Привет мир.';
      const sentences = service.extractSentences(text);
      
      expect(sentences.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle very long text', () => {
      const longSentence = 'This is a word. '.repeat(100);
      const sentences = service.extractSentences(longSentence);
      
      expect(sentences.length).toBeGreaterThan(0);
    });

    it('should handle text ending without punctuation', () => {
      const text = 'First sentence. Second sentence without end';
      const sentences = service.extractSentences(text);
      
      expect(sentences.length).toBeGreaterThanOrEqual(1);
    });
  });
});
