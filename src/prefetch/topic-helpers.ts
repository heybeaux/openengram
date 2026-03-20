import { KeywordRule, TopicDefinition, TopicId } from './prefetch.types';
import { KEYWORD_RULES } from './topic-keyword-rules';
import { TOPIC_DEFINITIONS } from './topic-taxonomy';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get topic definition by ID
 */
export function getTopicDefinition(
  topicId: TopicId,
): TopicDefinition | undefined {
  return TOPIC_DEFINITIONS.find((t) => t.id === topicId);
}

/**
 * Get all child topics for a parent topic
 */
export function getChildTopics(parentId: TopicId): TopicDefinition[] {
  return TOPIC_DEFINITIONS.filter((t) => t.parentId === parentId);
}

/**
 * Get related topics for a topic
 */
export function getRelatedTopics(topicId: TopicId): TopicId[] {
  const def = getTopicDefinition(topicId);
  return def?.relatedTopics || [];
}

/**
 * Get all root topics (no parent)
 */
export function getRootTopics(): TopicDefinition[] {
  return TOPIC_DEFINITIONS.filter((t) => !t.parentId);
}

/**
 * Get keyword rules for a specific topic
 */
export function getKeywordRulesForTopic(topicId: TopicId): KeywordRule[] {
  return KEYWORD_RULES.filter((r) => r.topic === topicId);
}

/**
 * Get all topic IDs
 */
export function getAllTopicIds(): TopicId[] {
  return TOPIC_DEFINITIONS.map((t) => t.id);
}
