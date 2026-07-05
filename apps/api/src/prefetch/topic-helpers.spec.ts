import { KEYWORD_RULES } from './topic-keyword-rules';
import { PERSONAL_TOPIC_DEFINITIONS } from './topic-definitions-personal';
import { SYSTEM_TOPIC_DEFINITIONS } from './topic-definitions-system';
import {
  getAllTopicIds,
  getChildTopics,
  getKeywordRulesForTopic,
  getRelatedTopics,
  getRootTopics,
  getTopicDefinition,
} from './topic-helpers';
import { TopicId } from './prefetch.types';

const ALL_TOPIC_DEFINITIONS = [
  ...PERSONAL_TOPIC_DEFINITIONS,
  ...SYSTEM_TOPIC_DEFINITIONS,
];

describe('topic-helpers', () => {
  describe('getTopicDefinition', () => {
    it('returns the matching definition object for an existing topic', () => {
      const familyDefinition = PERSONAL_TOPIC_DEFINITIONS.find(
        (topic) => topic.id === 'family',
      );

      expect(getTopicDefinition('family')).toBe(familyDefinition);
    });

    it('returns undefined for unknown topic IDs', () => {
      expect(getTopicDefinition('custom/not-defined')).toBeUndefined();
    });
  });

  describe('getChildTopics', () => {
    it('returns only topics whose parentId matches the requested parent', () => {
      const children = getChildTopics('family');

      expect(children.map((topic) => topic.id)).toEqual([
        'family/immediate',
        'family/extended',
        'family/pets',
      ]);
      expect(children.every((topic) => topic.parentId === 'family')).toBe(
        true,
      );
    });

    it('returns an empty array when a topic has no direct children', () => {
      expect(getChildTopics('conversation')).toEqual([]);
    });
  });

  describe('getRelatedTopics', () => {
    it('returns related topics for known topic IDs', () => {
      expect(getRelatedTopics('family')).toEqual([
        'schedule',
        'health',
        'events',
      ]);
    });

    it('returns an empty array for unknown topic IDs', () => {
      expect(getRelatedTopics('custom/missing')).toEqual([]);
    });
  });

  describe('getRootTopics', () => {
    it('returns topics without a parentId and excludes child topics', () => {
      const roots = getRootTopics();
      const rootIds = roots.map((topic) => topic.id);

      expect(rootIds).toContain('family');
      expect(rootIds).toContain('work');
      expect(rootIds).toContain('health');
      expect(rootIds).not.toContain('family/immediate');
      expect(roots.every((topic) => topic.parentId === undefined)).toBe(true);
    });
  });

  describe('getKeywordRulesForTopic', () => {
    it('returns exactly the keyword rules for the requested topic', () => {
      const workRules = getKeywordRulesForTopic('work');

      expect(workRules).toEqual(
        KEYWORD_RULES.filter((rule) => rule.topic === 'work'),
      );
      expect(workRules.length).toBeGreaterThan(0);
      expect(workRules.every((rule) => rule.topic === 'work')).toBe(true);
    });

    it('returns an empty array when no keyword rules exist for a topic', () => {
      expect(getKeywordRulesForTopic('custom/no-rules')).toEqual([]);
    });
  });

  describe('getAllTopicIds', () => {
    it('preserves the composed topic definition order', () => {
      expect(getAllTopicIds()).toEqual(
        ALL_TOPIC_DEFINITIONS.map((topic) => topic.id),
      );
    });

    it('includes every defined topic ID exactly once', () => {
      const ids = getAllTopicIds();
      const uniqueIds = new Set<TopicId>(ids);

      expect(uniqueIds.size).toBe(ids.length);
      expect(ids).toContain('identity/background');
      expect(ids).toContain('technical/tools');
    });
  });
});
