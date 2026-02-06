import {
  KEYWORD_RULES,
  TOPIC_DEFINITIONS,
  getTopicDefinition,
  getChildTopics,
  getRelatedTopics,
  getRootTopics,
  getKeywordRulesForTopic,
  getAllTopicIds,
} from './topic-taxonomy';
import { TopicId } from './prefetch.types';

describe('TopicTaxonomy', () => {
  describe('KEYWORD_RULES', () => {
    it('should have rules for all major topics', () => {
      const topics = new Set(KEYWORD_RULES.map(r => r.topic));
      
      expect(topics.has('family')).toBe(true);
      expect(topics.has('work')).toBe(true);
      expect(topics.has('schedule')).toBe(true);
      expect(topics.has('health')).toBe(true);
      expect(topics.has('technical')).toBe(true);
    });

    it('should have valid regex patterns', () => {
      for (const rule of KEYWORD_RULES) {
        for (const pattern of rule.patterns) {
          expect(pattern).toBeInstanceOf(RegExp);
        }
      }
    });

    it('should have weights between 0 and 1', () => {
      for (const rule of KEYWORD_RULES) {
        expect(rule.weight).toBeGreaterThanOrEqual(0);
        expect(rule.weight).toBeLessThanOrEqual(1);
      }
    });

    it('should match expected keywords for family', () => {
      const familyRules = KEYWORD_RULES.filter(r => r.topic === 'family');
      expect(familyRules.length).toBeGreaterThan(0);
      
      const allPatterns = familyRules.flatMap(r => r.patterns);
      const testWords = ['wife', 'husband', 'daughter', 'family'];
      
      for (const word of testWords) {
        const matches = allPatterns.some(p => p.test(word));
        expect(matches).toBe(true);
      }
    });

    it('should match expected keywords for work', () => {
      const workRules = KEYWORD_RULES.filter(r => r.topic === 'work');
      const allPatterns = workRules.flatMap(r => r.patterns);
      
      expect(allPatterns.some(p => p.test('meeting'))).toBe(true);
      expect(allPatterns.some(p => p.test('project'))).toBe(true);
    });

    it('should match expected keywords for schedule', () => {
      const scheduleRules = KEYWORD_RULES.filter(r => r.topic.startsWith('schedule'));
      const allPatterns = scheduleRules.flatMap(r => r.patterns);
      
      expect(allPatterns.some(p => p.test('today'))).toBe(true);
      expect(allPatterns.some(p => p.test('tomorrow'))).toBe(true);
      expect(allPatterns.some(p => p.test('calendar'))).toBe(true);
    });

    it('should mark contextual rules correctly', () => {
      const contextualRules = KEYWORD_RULES.filter(r => r.requiresContext);
      
      // Preferences and some agent rules should be contextual
      expect(contextualRules.some(r => r.topic === 'preferences')).toBe(true);
    });
  });

  describe('TOPIC_DEFINITIONS', () => {
    it('should define all standard topics', () => {
      const ids = TOPIC_DEFINITIONS.map(t => t.id);
      
      expect(ids).toContain('family');
      expect(ids).toContain('work');
      expect(ids).toContain('schedule');
      expect(ids).toContain('health');
      expect(ids).toContain('technical');
      expect(ids).toContain('preferences');
      expect(ids).toContain('identity');
    });

    it('should have valid parent references', () => {
      const ids = new Set(TOPIC_DEFINITIONS.map(t => t.id));
      
      for (const topic of TOPIC_DEFINITIONS) {
        if (topic.parentId) {
          expect(ids.has(topic.parentId)).toBe(true);
        }
      }
    });

    it('should have valid related topic references', () => {
      const ids = new Set(TOPIC_DEFINITIONS.map(t => t.id));
      
      for (const topic of TOPIC_DEFINITIONS) {
        for (const related of topic.relatedTopics) {
          expect(ids.has(related)).toBe(true);
        }
      }
    });

    it('should have prefetchPriority between 1 and 10', () => {
      for (const topic of TOPIC_DEFINITIONS) {
        expect(topic.prefetchPriority).toBeGreaterThanOrEqual(1);
        expect(topic.prefetchPriority).toBeLessThanOrEqual(10);
      }
    });

    it('should have positive defaultMemoryLimit', () => {
      for (const topic of TOPIC_DEFINITIONS) {
        expect(topic.defaultMemoryLimit).toBeGreaterThan(0);
      }
    });

    it('should have decayRate between 0 and 1', () => {
      for (const topic of TOPIC_DEFINITIONS) {
        expect(topic.decayRate).toBeGreaterThanOrEqual(0);
        expect(topic.decayRate).toBeLessThanOrEqual(1);
      }
    });

    it('should have non-empty prototypeQuery', () => {
      for (const topic of TOPIC_DEFINITIONS) {
        expect(topic.prototypeQuery.length).toBeGreaterThan(0);
      }
    });
  });

  describe('getTopicDefinition', () => {
    it('should return definition for known topic', () => {
      const def = getTopicDefinition('family');
      
      expect(def).toBeDefined();
      expect(def?.id).toBe('family');
      expect(def?.name).toBe('Family');
    });

    it('should return undefined for unknown topic', () => {
      const def = getTopicDefinition('nonexistent' as TopicId);
      expect(def).toBeUndefined();
    });

    it('should return definition with all required fields', () => {
      const def = getTopicDefinition('work');
      
      expect(def).toHaveProperty('id');
      expect(def).toHaveProperty('name');
      expect(def).toHaveProperty('description');
      expect(def).toHaveProperty('keywords');
      expect(def).toHaveProperty('prototypeQuery');
      expect(def).toHaveProperty('prefetchPriority');
      expect(def).toHaveProperty('defaultMemoryLimit');
      expect(def).toHaveProperty('decayRate');
      expect(def).toHaveProperty('relatedTopics');
    });
  });

  describe('getChildTopics', () => {
    it('should return child topics for parent', () => {
      const children = getChildTopics('family');
      
      expect(children.length).toBeGreaterThan(0);
      expect(children.every(c => c.parentId === 'family')).toBe(true);
    });

    it('should return empty array for topic with no children', () => {
      const children = getChildTopics('conversation');
      expect(children.length).toBe(0);
    });

    it('should return family/immediate as child of family', () => {
      const children = getChildTopics('family');
      const ids = children.map(c => c.id);
      
      expect(ids).toContain('family/immediate');
      expect(ids).toContain('family/extended');
      expect(ids).toContain('family/pets');
    });

    it('should return health children correctly', () => {
      const children = getChildTopics('health');
      const ids = children.map(c => c.id);
      
      expect(ids).toContain('health/physical');
      expect(ids).toContain('health/mental');
      expect(ids).toContain('health/medical');
    });
  });

  describe('getRelatedTopics', () => {
    it('should return related topics', () => {
      const related = getRelatedTopics('family');
      
      expect(related.length).toBeGreaterThan(0);
    });

    it('should return empty array for unknown topic', () => {
      const related = getRelatedTopics('nonexistent' as TopicId);
      expect(related).toEqual([]);
    });

    it('should return schedule as related to family', () => {
      const related = getRelatedTopics('family');
      expect(related).toContain('schedule');
    });

    it('should return work as related to projects', () => {
      const related = getRelatedTopics('projects');
      expect(related).toContain('work');
    });
  });

  describe('getRootTopics', () => {
    it('should return topics without parents', () => {
      const roots = getRootTopics();
      
      expect(roots.length).toBeGreaterThan(0);
      expect(roots.every(r => !r.parentId)).toBe(true);
    });

    it('should include major categories', () => {
      const roots = getRootTopics();
      const ids = roots.map(r => r.id);
      
      expect(ids).toContain('family');
      expect(ids).toContain('work');
      expect(ids).toContain('schedule');
      expect(ids).toContain('health');
      expect(ids).toContain('identity');
    });

    it('should not include child topics', () => {
      const roots = getRootTopics();
      const ids = roots.map(r => r.id);
      
      expect(ids).not.toContain('family/immediate');
      expect(ids).not.toContain('health/physical');
      expect(ids).not.toContain('schedule/today');
    });
  });

  describe('getKeywordRulesForTopic', () => {
    it('should return keyword rules for topic', () => {
      const rules = getKeywordRulesForTopic('family');
      
      expect(rules.length).toBeGreaterThan(0);
      expect(rules.every(r => r.topic === 'family')).toBe(true);
    });

    it('should return empty array for topic without rules', () => {
      const rules = getKeywordRulesForTopic('nonexistent' as TopicId);
      expect(rules).toEqual([]);
    });
  });

  describe('getAllTopicIds', () => {
    it('should return all topic IDs', () => {
      const ids = getAllTopicIds();
      
      expect(ids.length).toBe(TOPIC_DEFINITIONS.length);
    });

    it('should include both parent and child topics', () => {
      const ids = getAllTopicIds();
      
      expect(ids).toContain('family');
      expect(ids).toContain('family/immediate');
    });
  });

  describe('topic hierarchy consistency', () => {
    it('should have consistent hierarchy depth', () => {
      for (const topic of TOPIC_DEFINITIONS) {
        if (topic.parentId) {
          const parent = getTopicDefinition(topic.parentId);
          expect(parent).toBeDefined();
          
          // Child should have lower or equal priority than parent generally
          // (this is a soft check)
        }
      }
    });

    it('should have bidirectional relationships where expected', () => {
      // Check some key bidirectional relationships
      const familyRelated = getRelatedTopics('family');
      const scheduleRelated = getRelatedTopics('schedule');
      
      // If family is related to schedule, schedule should be related to family
      if (familyRelated.includes('schedule')) {
        expect(scheduleRelated).toContain('family');
      }
    });
  });
});
