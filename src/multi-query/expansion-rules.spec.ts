import {
  SYNONYM_GROUPS,
  RELATED_CONCEPTS,
  DEFAULT_PERSON_EXPANSIONS,
  PATTERN_RULES,
  normalizeQuery,
  deduplicateSimilarQueries,
} from './expansion-rules';

describe('expansion-rules', () => {
  describe('SYNONYM_GROUPS', () => {
    it('should have synonym group for "like"', () => {
      expect(SYNONYM_GROUPS['like']).toBeDefined();
      expect(SYNONYM_GROUPS['like']).toContain('prefer');
      expect(SYNONYM_GROUPS['like']).toContain('enjoy');
      expect(SYNONYM_GROUPS['like']).toContain('love');
    });

    it('should have synonym group for "dislike"', () => {
      expect(SYNONYM_GROUPS['dislike']).toBeDefined();
      expect(SYNONYM_GROUPS['dislike']).toContain('hate');
      expect(SYNONYM_GROUPS['dislike']).toContain('avoid');
    });

    it('should have synonym group for "learn"', () => {
      expect(SYNONYM_GROUPS['learn']).toBeDefined();
      expect(SYNONYM_GROUPS['learn']).toContain('discover');
      expect(SYNONYM_GROUPS['learn']).toContain('realize');
    });

    it('should have synonym group for temporal words', () => {
      expect(SYNONYM_GROUPS['today']).toBeDefined();
      expect(SYNONYM_GROUPS['yesterday']).toBeDefined();
      expect(SYNONYM_GROUPS['tomorrow']).toBeDefined();
    });

    it('should have synonym group for work terms', () => {
      expect(SYNONYM_GROUPS['project']).toBeDefined();
      expect(SYNONYM_GROUPS['meeting']).toBeDefined();
      expect(SYNONYM_GROUPS['deploy']).toBeDefined();
    });

    it('should have synonym group for people terms', () => {
      expect(SYNONYM_GROUPS['friend']).toBeDefined();
      expect(SYNONYM_GROUPS['family']).toBeDefined();
      expect(SYNONYM_GROUPS['child']).toBeDefined();
    });
  });

  describe('RELATED_CONCEPTS', () => {
    it('should have related concepts for "like"', () => {
      expect(RELATED_CONCEPTS['like']).toBeDefined();
      expect(RELATED_CONCEPTS['like']).toContain('preference');
      expect(RELATED_CONCEPTS['like']).toContain('favorite');
    });

    it('should have related concepts for "work"', () => {
      expect(RELATED_CONCEPTS['work']).toBeDefined();
      expect(RELATED_CONCEPTS['work']).toContain('job');
      expect(RELATED_CONCEPTS['work']).toContain('career');
    });

    it('should have related concepts for "learn"', () => {
      expect(RELATED_CONCEPTS['learn']).toBeDefined();
      expect(RELATED_CONCEPTS['learn']).toContain('education');
      expect(RELATED_CONCEPTS['learn']).toContain('knowledge');
    });

    it('should have related concepts for "problem"', () => {
      expect(RELATED_CONCEPTS['problem']).toBeDefined();
      expect(RELATED_CONCEPTS['problem']).toContain('issue');
      expect(RELATED_CONCEPTS['problem']).toContain('bug');
    });
  });

  describe('DEFAULT_PERSON_EXPANSIONS', () => {
    it('should have expansions for "i"', () => {
      expect(DEFAULT_PERSON_EXPANSIONS['i']).toBeDefined();
      expect(DEFAULT_PERSON_EXPANSIONS['i']).toContain('user');
    });

    it('should have expansions for "my"', () => {
      expect(DEFAULT_PERSON_EXPANSIONS['my']).toBeDefined();
      expect(DEFAULT_PERSON_EXPANSIONS['my']).toContain('user');
    });

    it('should have expansions for "me"', () => {
      expect(DEFAULT_PERSON_EXPANSIONS['me']).toBeDefined();
      expect(DEFAULT_PERSON_EXPANSIONS['me']).toContain('user');
    });
  });

  describe('PATTERN_RULES', () => {
    describe('preference-query pattern', () => {
      const rule = PATTERN_RULES.find(r => r.name === 'preference-query');

      it('should exist', () => {
        expect(rule).toBeDefined();
      });

      it('should match "What does Beaux like?"', () => {
        const match = 'What does Beaux like?'.match(rule!.pattern);
        expect(match).toBeTruthy();
        expect(match![1]).toBe('Beaux');
        expect(match![2]).toBe('like');
      });

      it('should generate preference variants', () => {
        const match = 'What does Beaux like?'.match(rule!.pattern);
        const variants = rule!.transform(match!, 'What does Beaux like?');
        
        expect(variants).toContain('Beaux preferences');
        expect(variants).toContain('Beaux favorites');
        expect(variants.some(v => v.includes('dislikes'))).toBe(true);
      });
    });

    describe('tell-about pattern', () => {
      const rule = PATTERN_RULES.find(r => r.name === 'tell-about');

      it('should match "Tell me about Stella"', () => {
        const match = 'Tell me about Stella'.match(rule!.pattern);
        expect(match).toBeTruthy();
        expect(match![1]).toBe('Stella');
      });

      it('should generate information variants', () => {
        const match = 'Tell me about Engram'.match(rule!.pattern);
        const variants = rule!.transform(match!, 'Tell me about Engram');
        
        expect(variants).toContain('Engram details');
        expect(variants).toContain('Engram information');
      });
    });

    describe('how-to pattern', () => {
      const rule = PATTERN_RULES.find(r => r.name === 'how-to');

      it('should match "How do I deploy?"', () => {
        const match = 'How do I deploy?'.match(rule!.pattern);
        expect(match).toBeTruthy();
      });

      it('should match "How can I fix this?"', () => {
        const match = 'How can I fix this?'.match(rule!.pattern);
        expect(match).toBeTruthy();
      });

      it('should generate guide variants', () => {
        const match = 'How do I deploy?'.match(rule!.pattern);
        const variants = rule!.transform(match!, 'How do I deploy?');
        
        expect(variants.some(v => v.includes('guide'))).toBe(true);
        expect(variants.some(v => v.includes('steps'))).toBe(true);
      });
    });

    describe('when-query pattern', () => {
      const rule = PATTERN_RULES.find(r => r.name === 'when-query');

      it('should match "When did we meet?"', () => {
        const match = 'When did we meet?'.match(rule!.pattern);
        expect(match).toBeTruthy();
      });

      it('should generate temporal variants', () => {
        const match = 'When did we meet?'.match(rule!.pattern);
        const variants = rule!.transform(match!, 'When did we meet?');
        
        expect(variants.some(v => v.includes('date'))).toBe(true);
        expect(variants.some(v => v.includes('time'))).toBe(true);
      });
    });

    describe('why-query pattern', () => {
      const rule = PATTERN_RULES.find(r => r.name === 'why-query');

      it('should match "Why does this fail?"', () => {
        const match = 'Why does this fail?'.match(rule!.pattern);
        expect(match).toBeTruthy();
      });

      it('should generate reason variants', () => {
        const match = 'Why does this fail?'.match(rule!.pattern);
        const variants = rule!.transform(match!, 'Why does this fail?');
        
        expect(variants.some(v => v.includes('reason'))).toBe(true);
        expect(variants.some(v => v.includes('cause'))).toBe(true);
      });
    });

    describe('where-query pattern', () => {
      const rule = PATTERN_RULES.find(r => r.name === 'where-query');

      it('should match "Where is the config?"', () => {
        const match = 'Where is the config?'.match(rule!.pattern);
        expect(match).toBeTruthy();
      });

      it('should generate location variants', () => {
        const match = 'Where is the config?'.match(rule!.pattern);
        const variants = rule!.transform(match!, 'Where is the config?');
        
        expect(variants.some(v => v.includes('location'))).toBe(true);
        expect(variants.some(v => v.includes('find'))).toBe(true);
      });
    });

    describe('what-happened pattern', () => {
      const rule = PATTERN_RULES.find(r => r.name === 'what-happened');

      it('should match "What happened with the release?"', () => {
        const match = 'What happened with the release?'.match(rule!.pattern);
        expect(match).toBeTruthy();
      });

      it('should generate event variants', () => {
        const match = 'What happened with the release?'.match(rule!.pattern);
        const variants = rule!.transform(match!, 'What happened with the release?');
        
        expect(variants.some(v => v.includes('events'))).toBe(true);
        expect(variants.some(v => v.includes('update'))).toBe(true);
      });
    });

    describe('remember-when pattern', () => {
      const rule = PATTERN_RULES.find(r => r.name === 'remember-when');

      it('should match "Remember when we deployed?"', () => {
        const match = 'Remember when we deployed?'.match(rule!.pattern);
        expect(match).toBeTruthy();
      });

      it('should generate memory variants', () => {
        const match = 'Remember when we deployed?'.match(rule!.pattern);
        const variants = rule!.transform(match!, 'Remember when we deployed?');
        
        expect(variants.some(v => v.includes('memory'))).toBe(true);
        expect(variants.some(v => v.includes('happened'))).toBe(true);
      });
    });

    describe('best-practices pattern', () => {
      const rule = PATTERN_RULES.find(r => r.name === 'best-practices');

      it('should match "deployment best practices"', () => {
        const match = 'deployment best practices'.match(rule!.pattern);
        expect(match).toBeTruthy();
      });

      it('should generate guideline variants', () => {
        const match = 'deployment best practices'.match(rule!.pattern);
        const variants = rule!.transform(match!, 'deployment best practices');
        
        expect(variants.some(v => v.includes('guidelines'))).toBe(true);
        expect(variants.some(v => v.includes('recommendations'))).toBe(true);
      });
    });

    describe('problems-with pattern', () => {
      const rule = PATTERN_RULES.find(r => r.name === 'problems-with');

      it('should match "problems with the API"', () => {
        const match = 'problems with the API'.match(rule!.pattern);
        expect(match).toBeTruthy();
      });

      it('should match "issue with the build"', () => {
        const match = 'issue with the build'.match(rule!.pattern);
        expect(match).toBeTruthy();
      });

      it('should generate problem variants', () => {
        const match = 'problems with the API'.match(rule!.pattern);
        const variants = rule!.transform(match!, 'problems with the API');
        
        expect(variants.some(v => v.includes('bugs'))).toBe(true);
        expect(variants.some(v => v.includes('fix'))).toBe(true);
      });
    });

    describe('what-know pattern', () => {
      const rule = PATTERN_RULES.find(r => r.name === 'what-know');

      it('should match "What do I know about Engram?"', () => {
        const match = 'What do I know about Engram?'.match(rule!.pattern);
        expect(match).toBeTruthy();
      });

      it('should generate knowledge variants', () => {
        const match = 'What do I know about Engram?'.match(rule!.pattern);
        const variants = rule!.transform(match!, 'What do I know about Engram?');
        
        expect(variants).toContain('Engram');
        expect(variants.some(v => v.includes('details'))).toBe(true);
      });
    });

    describe('what-learn pattern', () => {
      const rule = PATTERN_RULES.find(r => r.name === 'what-learn');

      it('should match "What did I learn?"', () => {
        const match = 'What did I learn?'.match(rule!.pattern);
        expect(match).toBeTruthy();
      });

      it('should match "What have I learned?"', () => {
        const match = 'What have I learned?'.match(rule!.pattern);
        expect(match).toBeTruthy();
      });

      it('should generate lesson variants', () => {
        const match = 'What did I learn?'.match(rule!.pattern);
        const variants = rule!.transform(match!, 'What did I learn?');
        
        expect(variants).toContain('lessons learned');
        expect(variants).toContain('insights');
        expect(variants).toContain('discoveries');
      });
    });

    describe('who-is pattern', () => {
      const rule = PATTERN_RULES.find(r => r.name === 'who-is');

      it('should match "Who is Deanna?"', () => {
        const match = 'Who is Deanna?'.match(rule!.pattern);
        expect(match).toBeTruthy();
      });

      it('should generate person variants', () => {
        const match = 'Who is Deanna?'.match(rule!.pattern);
        const variants = rule!.transform(match!, 'Who is Deanna?');
        
        expect(variants).toContain('Deanna');
        expect(variants.some(v => v.includes('about'))).toBe(true);
      });
    });

    describe('what-is pattern', () => {
      const rule = PATTERN_RULES.find(r => r.name === 'what-is');

      it('should match "What is Engram?"', () => {
        const match = 'What is Engram?'.match(rule!.pattern);
        expect(match).toBeTruthy();
      });

      it('should generate definition variants', () => {
        const match = 'What is Engram?'.match(rule!.pattern);
        const variants = rule!.transform(match!, 'What is Engram?');
        
        expect(variants).toContain('Engram');
        expect(variants.some(v => v.includes('definition'))).toBe(true);
        expect(variants.some(v => v.includes('explanation'))).toBe(true);
      });
    });
  });

  describe('normalizeQuery', () => {
    it('should lowercase query', () => {
      expect(normalizeQuery('Hello World')).toBe('hello world');
    });

    it('should remove punctuation', () => {
      expect(normalizeQuery('Hello, World!')).toBe('hello world');
    });

    it('should collapse whitespace', () => {
      expect(normalizeQuery('Hello   World')).toBe('hello world');
    });

    it('should sort words alphabetically', () => {
      expect(normalizeQuery('world hello')).toBe('hello world');
    });

    it('should handle complex queries', () => {
      expect(normalizeQuery('What does Beaux like?')).toBe('beaux does like what');
    });
  });

  describe('deduplicateSimilarQueries', () => {
    it('should remove exact duplicates', () => {
      const queries = ['hello', 'hello', 'world'];
      const result = deduplicateSimilarQueries(queries);
      expect(result).toEqual(['hello', 'world']);
    });

    it('should remove case-insensitive duplicates', () => {
      const queries = ['Hello', 'hello', 'HELLO'];
      const result = deduplicateSimilarQueries(queries);
      expect(result).toEqual(['Hello']);
    });

    it('should remove queries that differ only in punctuation', () => {
      const queries = ['Hello!', 'Hello?', 'Hello'];
      const result = deduplicateSimilarQueries(queries);
      expect(result).toEqual(['Hello!']);
    });

    it('should remove queries with same words in different order', () => {
      const queries = ['hello world', 'world hello'];
      const result = deduplicateSimilarQueries(queries);
      expect(result).toEqual(['hello world']);
    });

    it('should preserve distinct queries', () => {
      const queries = ['hello world', 'foo bar', 'test query'];
      const result = deduplicateSimilarQueries(queries);
      expect(result).toEqual(['hello world', 'foo bar', 'test query']);
    });

    it('should handle empty array', () => {
      const result = deduplicateSimilarQueries([]);
      expect(result).toEqual([]);
    });
  });
});
