import { ImportanceDetectorService } from './importance-detector.service';
import { MessageTurnDto, MessageRole, ImportanceSignal } from './dto/observe.dto';

function turn(content: string, role: MessageRole = MessageRole.USER): MessageTurnDto {
  return { role, content } as MessageTurnDto;
}

describe('ImportanceDetectorService', () => {
  let service: ImportanceDetectorService;

  beforeEach(() => {
    service = new ImportanceDetectorService();
  });

  // --- detect() basics ---

  it('should return empty array for empty turns', () => {
    expect(service.detect([])).toEqual([]);
  });

  it('should return empty array for null/undefined input', () => {
    expect(service.detect(null as any)).toEqual([]);
    expect(service.detect(undefined as any)).toEqual([]);
  });

  // --- Explicit signals ---

  it('should detect "remember this"', () => {
    const signals = service.detect([turn('Please remember this fact about me')]);
    expect(signals).toHaveLength(1);
    expect(signals[0].type).toBe('explicit');
    expect(signals[0].trigger).toMatch(/remember this/i);
  });

  it('should detect "never forget"', () => {
    const signals = service.detect([turn('Never forget my allergy to peanuts')]);
    expect(signals.some(s => s.type === 'explicit')).toBe(true);
  });

  it('should detect "this is important"', () => {
    const signals = service.detect([turn('This is important: I changed my phone number')]);
    expect(signals.some(s => s.type === 'explicit')).toBe(true);
  });

  it('should detect "keep in mind"', () => {
    const signals = service.detect([turn('Keep in mind that I work remotely')]);
    expect(signals.some(s => s.type === 'explicit')).toBe(true);
  });

  it('should detect "FYI"', () => {
    const signals = service.detect([turn('FYI I switched to a new email')]);
    expect(signals.some(s => s.type === 'explicit')).toBe(true);
  });

  it('should detect "critical!"', () => {
    const signals = service.detect([turn('Critical! The API key was rotated')]);
    expect(signals.some(s => s.type === 'explicit')).toBe(true);
  });

  // --- Correction signals ---

  it('should detect "actually" as correction', () => {
    const signals = service.detect([turn('Actually, my name is spelled differently')]);
    expect(signals.some(s => s.type === 'correction')).toBe(true);
  });

  it('should detect "I meant" as correction', () => {
    const signals = service.detect([turn("Sorry, I meant Tuesday not Thursday")]);
    expect(signals.some(s => s.type === 'correction')).toBe(true);
  });

  it('should detect "to clarify" as correction', () => {
    const signals = service.detect([turn('To clarify, the meeting is at 3pm not 2pm')]);
    expect(signals.some(s => s.type === 'correction')).toBe(true);
  });

  // --- Preference signals ---

  it('should detect "I prefer" from user', () => {
    const signals = service.detect([turn('I prefer dark chocolate over milk chocolate')]);
    expect(signals.some(s => s.type === 'preference')).toBe(true);
  });

  it('should detect "I always" from user', () => {
    const signals = service.detect([turn('I always drink coffee in the morning')]);
    expect(signals.some(s => s.type === 'preference')).toBe(true);
  });

  it('should detect "I hate" from user', () => {
    const signals = service.detect([turn('I hate when apps send too many notifications')]);
    expect(signals.some(s => s.type === 'preference')).toBe(true);
  });

  it('should detect "my favorite" from user', () => {
    const signals = service.detect([turn('My favorite programming language is TypeScript')]);
    expect(signals.some(s => s.type === 'preference')).toBe(true);
  });

  it('should NOT detect preference from assistant role', () => {
    const signals = service.detect([turn('I prefer to help you with that', MessageRole.ASSISTANT)]);
    expect(signals.some(s => s.type === 'preference')).toBe(false);
  });

  // --- Repetition detection ---

  it('should detect repeated capitalized concepts', () => {
    const signals = service.detect([
      turn('I use React for my projects at Google'),
      turn('React is what I code in daily at Google'),
      turn('Most of my work is React at Google'),
    ]);
    // Repetition depends on extractConcepts finding capitalized/quoted/technical terms
    const repetitions = signals.filter(s => s.type === 'repetition');
    expect(repetitions.length).toBeGreaterThanOrEqual(1);
  });

  it('should not flag single mentions as repetition', () => {
    const signals = service.detect([
      turn('I like pizza'),
      turn('The weather is nice today'),
    ]);
    expect(signals.filter(s => s.type === 'repetition')).toHaveLength(0);
  });

  // --- Multiple signal types in one conversation ---

  it('should detect multiple signal types', () => {
    const signals = service.detect([
      turn('I prefer TypeScript over JavaScript'),
      turn('Actually, I should clarify - I use both but prefer TypeScript'),
      turn('Remember this: TypeScript is my primary language'),
    ]);
    const types = new Set(signals.map(s => s.type));
    expect(types.size).toBeGreaterThanOrEqual(2);
  });

  // --- One signal per type per turn ---

  it('should produce at most one explicit signal per turn', () => {
    const signals = service.detect([
      turn('Remember this important thing: critical! Never forget it'),
    ]);
    const explicit = signals.filter(s => s.type === 'explicit');
    expect(explicit).toHaveLength(1);
  });

  // --- Confidence scores ---

  it('should give high confidence to explicit "never forget"', () => {
    const signals = service.detect([turn('Never forget my severe peanut allergy please')]);
    const explicit = signals.find(s => s.type === 'explicit');
    expect(explicit).toBeDefined();
    expect(explicit!.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('should give lower confidence to short content', () => {
    const signals = service.detect([turn('Remember this')]);
    const explicit = signals.find(s => s.type === 'explicit');
    expect(explicit).toBeDefined();
    // Short content reduces confidence by 0.8x
    expect(explicit!.confidence).toBeLessThan(0.9);
  });

  it('should give higher confidence for "always/never/hate/love" preferences', () => {
    const signals1 = service.detect([turn('I always take my coffee black in the mornings')]);
    const signals2 = service.detect([turn('I like coffee in the morning sometimes maybe')]);
    const pref1 = signals1.find(s => s.type === 'preference');
    const pref2 = signals2.find(s => s.type === 'preference');
    expect(pref1).toBeDefined();
    expect(pref2).toBeDefined();
    expect(pref1!.confidence).toBeGreaterThan(pref2!.confidence);
  });

  // --- calculateImportance() ---

  it('should return base importance 0.3 for no signals', () => {
    expect(service.calculateImportance([])).toBe(0.3);
  });

  it('should return high importance for explicit signals', () => {
    const signals: ImportanceSignal[] = [
      { type: 'explicit', trigger: 'remember this', content: 'test', turnIndex: 0, confidence: 0.9 },
    ];
    const importance = service.calculateImportance(signals);
    expect(importance).toBeGreaterThanOrEqual(0.8);
  });

  it('should boost importance for multiple signals', () => {
    const single: ImportanceSignal[] = [
      { type: 'preference', trigger: 'I prefer', content: 'test', turnIndex: 0, confidence: 0.75 },
    ];
    const multiple: ImportanceSignal[] = [
      { type: 'preference', trigger: 'I prefer', content: 'test', turnIndex: 0, confidence: 0.75 },
      { type: 'explicit', trigger: 'remember', content: 'test', turnIndex: 1, confidence: 0.9 },
      { type: 'correction', trigger: 'actually', content: 'test', turnIndex: 2, confidence: 0.85 },
    ];
    expect(service.calculateImportance(multiple)).toBeGreaterThan(
      service.calculateImportance(single),
    );
  });

  it('should cap importance at 1.0', () => {
    const signals: ImportanceSignal[] = Array(10).fill({
      type: 'explicit',
      trigger: 'remember',
      content: 'test',
      turnIndex: 0,
      confidence: 0.95,
    });
    expect(service.calculateImportance(signals)).toBeLessThanOrEqual(1.0);
  });

  // --- extractContext (tested indirectly) ---

  it('should extract context around matched pattern', () => {
    const signals = service.detect([
      turn('I had pizza for lunch. Remember this: I am vegetarian. It was great.'),
    ]);
    const explicit = signals.find(s => s.type === 'explicit');
    expect(explicit).toBeDefined();
    expect(explicit!.content).toContain('vegetarian');
  });

  // --- Edge cases ---

  it('should handle turns with empty content', () => {
    const signals = service.detect([turn('')]);
    expect(signals).toEqual([]);
  });

  it('should handle assistant-only turns', () => {
    const signals = service.detect([
      turn('Here is some information', MessageRole.ASSISTANT),
      turn('Let me help you with that', MessageRole.ASSISTANT),
    ]);
    // No preference signals from assistant, but explicit/correction still possible
    expect(signals.every(s => s.type !== 'preference')).toBe(true);
  });
});
