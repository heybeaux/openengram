/**
 * Topic Taxonomy
 *
 * Barrel file — re-exports all topic taxonomy symbols for backward compatibility.
 * Implementation is split across focused sub-files:
 *   - topic-keyword-rules.ts  — KEYWORD_RULES constant
 *   - topic-definitions-personal.ts — PERSONAL_TOPIC_DEFINITIONS
 *   - topic-definitions-system.ts   — SYSTEM_TOPIC_DEFINITIONS
 *   - topic-helpers.ts         — helper functions
 */

import { TopicDefinition } from './prefetch.types';
import { PERSONAL_TOPIC_DEFINITIONS } from './topic-definitions-personal';
import { SYSTEM_TOPIC_DEFINITIONS } from './topic-definitions-system';

// Merge all topic definitions in order (maintains original ordering)
export const TOPIC_DEFINITIONS: TopicDefinition[] = [
  ...PERSONAL_TOPIC_DEFINITIONS,
  ...SYSTEM_TOPIC_DEFINITIONS,
];

export { KEYWORD_RULES } from './topic-keyword-rules';
export {
  getTopicDefinition,
  getChildTopics,
  getRelatedTopics,
  getRootTopics,
  getKeywordRulesForTopic,
  getAllTopicIds,
} from './topic-helpers';
