/**
 * Topic Taxonomy
 *
 * Defines the hierarchical topic structure, keyword rules,
 * and default configuration for topic detection.
 */

import { KeywordRule, TopicDefinition, TopicId } from './prefetch.types';

// ============================================================================
// Keyword Rules
// ============================================================================

/**
 * Keyword matching rules for fast first-pass topic detection
 */
export const KEYWORD_RULES: KeywordRule[] = [
  // Family
  {
    topic: 'family',
    patterns: [
      /\b(wife|husband|daughter|son|kid|child|baby|spouse)\b/i,
      /\b(mom|dad|mother|father|parent|sibling|brother|sister)\b/i,
      /\b(family|home|house|domestic)\b/i,
    ],
    weight: 0.6,
  },
  {
    topic: 'family/immediate',
    patterns: [
      /\b(wife|husband|spouse|partner)\b/i,
      /\b(daughter|son|child|kid|baby|toddler)\b/i,
    ],
    weight: 0.7,
  },
  {
    topic: 'family/extended',
    patterns: [
      /\b(mom|dad|mother|father|parent)\b/i,
      /\b(brother|sister|sibling|aunt|uncle|cousin)\b/i,
      /\b(grandma|grandpa|grandmother|grandfather|grandparent)\b/i,
    ],
    weight: 0.6,
  },
  {
    topic: 'family/pets',
    patterns: [
      /\b(dog|cat|pet|puppy|kitten)\b/i,
      /\b(husky|retriever|labrador|german shepherd)\b/i,
      /\b(walk the dog|feed the cat|vet)\b/i,
    ],
    weight: 0.7,
  },

  // Work/Projects
  {
    topic: 'work',
    patterns: [
      /\b(project|work|task|deadline|meeting|standup|sprint)\b/i,
      /\b(client|stakeholder|manager|team|colleague)\b/i,
      /\b(office|workplace|job|career)\b/i,
    ],
    weight: 0.5,
  },
  {
    topic: 'work/role',
    patterns: [
      /\b(my role|my job|my position|my title)\b/i,
      /\b(responsibilities|duties|job description)\b/i,
    ],
    weight: 0.6,
  },
  {
    topic: 'work/colleagues',
    patterns: [
      /\b(colleague|coworker|teammate|boss|manager)\b/i,
      /\b(team member|direct report|supervisor)\b/i,
    ],
    weight: 0.6,
  },
  {
    topic: 'projects',
    patterns: [
      /\b(project|initiative|effort|build|develop)\b/i,
      /\b(working on|building|developing|creating)\b/i,
    ],
    weight: 0.5,
  },
  {
    topic: 'projects/active',
    patterns: [
      /\b(current project|working on|active)\b/i,
      /\b(in progress|ongoing|building now)\b/i,
    ],
    weight: 0.6,
  },

  // Schedule
  {
    topic: 'schedule',
    patterns: [
      /\b(today|tomorrow|yesterday|next week|last week)\b/i,
      /\b(meeting|appointment|calendar|schedule|remind)\b/i,
      /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
      /\b(\d{1,2}:\d{2}|morning|afternoon|evening|noon)\b/i,
    ],
    weight: 0.5,
  },
  {
    topic: 'schedule/today',
    patterns: [
      /\b(today|this morning|this afternoon|tonight)\b/i,
      /\b(today's|today's schedule|today's meeting)\b/i,
    ],
    weight: 0.7,
  },
  {
    topic: 'schedule/week',
    patterns: [
      /\b(this week|next week|last week)\b/i,
      /\b(weekly|week's|weekly meeting)\b/i,
    ],
    weight: 0.6,
  },
  {
    topic: 'events',
    patterns: [
      /\b(event|meeting|conference|workshop)\b/i,
      /\b(birthday|anniversary|holiday|celebration)\b/i,
    ],
    weight: 0.5,
  },
  {
    topic: 'events/meetings',
    patterns: [
      /\b(meeting|standup|sync|one-on-one|1:1)\b/i,
      /\b(call|video call|zoom|teams)\b/i,
    ],
    weight: 0.6,
  },
  {
    topic: 'events/deadlines',
    patterns: [
      /\b(deadline|due date|due by|must finish)\b/i,
      /\b(submission|deliverable|milestone)\b/i,
    ],
    weight: 0.7,
  },

  // Health
  {
    topic: 'health',
    patterns: [
      /\b(health|sick|doctor|medicine|symptom|pain|injury)\b/i,
      /\b(exercise|workout|gym|run|training|diet|nutrition)\b/i,
      /\b(sleep|tired|energy|stress|anxiety|mental)\b/i,
    ],
    weight: 0.6,
  },
  {
    topic: 'health/physical',
    patterns: [
      /\b(exercise|workout|gym|fitness|running|lifting)\b/i,
      /\b(diet|nutrition|weight|calories|meal)\b/i,
      /\b(injury|pain|muscle|joint)\b/i,
    ],
    weight: 0.6,
  },
  {
    topic: 'health/mental',
    patterns: [
      /\b(stress|anxiety|depression|mood|mental health)\b/i,
      /\b(therapy|therapist|counseling|meditation)\b/i,
      /\b(overwhelmed|burnout|anxious|worried)\b/i,
    ],
    weight: 0.7,
  },
  {
    topic: 'health/medical',
    patterns: [
      /\b(doctor|hospital|clinic|appointment|checkup)\b/i,
      /\b(medication|prescription|medicine|treatment)\b/i,
      /\b(diagnosis|condition|symptoms)\b/i,
    ],
    weight: 0.7,
  },

  // Preferences
  {
    topic: 'preferences',
    patterns: [
      /\b(like|prefer|favorite|hate|love|enjoy|dislike)\b/i,
      /\b(always|never|usually|typically)\b/i,
    ],
    weight: 0.4,
    requiresContext: true,
  },
  {
    topic: 'preferences/likes',
    patterns: [
      /\b(like|love|enjoy|prefer|favorite)\b/i,
      /\b(my favorite|i love|i enjoy)\b/i,
    ],
    weight: 0.5,
    requiresContext: true,
  },
  {
    topic: 'preferences/dislikes',
    patterns: [
      /\b(hate|dislike|can't stand|don't like)\b/i,
      /\b(avoid|never|refuse)\b/i,
    ],
    weight: 0.5,
    requiresContext: true,
  },

  // Technical/Engineering
  {
    topic: 'technical',
    patterns: [
      /\b(api|database|server|deploy|kubernetes|docker)\b/i,
      /\b(typescript|javascript|python|rust|sql|node)\b/i,
      /\b(error|exception|bug|debug|trace|log)\b/i,
      /\b(code|programming|software|development)\b/i,
    ],
    weight: 0.7,
  },
  {
    topic: 'technical/skills',
    patterns: [
      /\b(skill|expertise|proficient|experienced)\b/i,
      /\b(learned|learning|studying|mastering)\b/i,
    ],
    weight: 0.5,
  },
  {
    topic: 'technical/tools',
    patterns: [
      /\b(tool|framework|library|platform|service)\b/i,
      /\b(git|github|gitlab|vscode|ide)\b/i,
      /\b(aws|gcp|azure|cloud)\b/i,
    ],
    weight: 0.6,
  },

  // Identity
  {
    topic: 'identity',
    patterns: [
      /\b(i am|i'm|my name|about me)\b/i,
      /\b(my background|where i'm from|grew up)\b/i,
    ],
    weight: 0.5,
  },
  {
    topic: 'identity/values',
    patterns: [
      /\b(believe|value|important to me|care about)\b/i,
      /\b(principle|philosophy|worldview)\b/i,
    ],
    weight: 0.6,
  },
  {
    topic: 'identity/background',
    patterns: [
      /\b(grew up|childhood|hometown|where i'm from)\b/i,
      /\b(history|past|background|origin)\b/i,
    ],
    weight: 0.5,
  },

  // Agent
  {
    topic: 'agent',
    patterns: [
      /\b(you|yourself|your|rook)\b/i,
      /\b(remember when you|you said|you told me)\b/i,
    ],
    weight: 0.4,
    requiresContext: true,
  },
  {
    topic: 'agent/self',
    patterns: [
      /\b(about yourself|tell me about you|who are you)\b/i,
      /\b(your memory|your knowledge|you remember)\b/i,
    ],
    weight: 0.6,
  },
  {
    topic: 'agent/learnings',
    patterns: [
      /\b(learned|lesson|mistake|discovered)\b/i,
      /\b(insight|realization|understanding)\b/i,
    ],
    weight: 0.5,
  },

  // Conversation
  {
    topic: 'conversation',
    patterns: [
      /\b(we talked|we discussed|last time|previous conversation)\b/i,
      /\b(remember when|earlier you said|you mentioned)\b/i,
    ],
    weight: 0.5,
  },
];

// ============================================================================
// Topic Definitions
// ============================================================================

/**
 * Full topic definitions with metadata and configuration
 */
export const TOPIC_DEFINITIONS: TopicDefinition[] = [
  // Personal
  {
    id: 'family',
    name: 'Family',
    description: 'Memories about family members and family life',
    keywords: ['wife', 'husband', 'daughter', 'son', 'kid', 'child', 'family'],
    prototypeQuery: 'family relationships spouse children parents home life',
    prefetchPriority: 8,
    defaultMemoryLimit: 30,
    decayRate: 0.1,
    relatedTopics: ['schedule', 'health', 'events'],
  },
  {
    id: 'family/immediate',
    parentId: 'family',
    name: 'Immediate Family',
    description: 'Spouse and children',
    keywords: ['wife', 'husband', 'daughter', 'son', 'spouse'],
    prototypeQuery: 'wife husband daughter son spouse child immediate family',
    prefetchPriority: 9,
    defaultMemoryLimit: 50,
    decayRate: 0.05,
    relatedTopics: ['family', 'schedule', 'health'],
  },
  {
    id: 'family/extended',
    parentId: 'family',
    name: 'Extended Family',
    description: 'Parents, siblings, and other relatives',
    keywords: ['mom', 'dad', 'mother', 'father', 'brother', 'sister'],
    prototypeQuery: 'parents siblings relatives extended family',
    prefetchPriority: 6,
    defaultMemoryLimit: 20,
    decayRate: 0.15,
    relatedTopics: ['family', 'events'],
  },
  {
    id: 'family/pets',
    parentId: 'family',
    name: 'Pets',
    description: 'Family pets and animals',
    keywords: ['dog', 'cat', 'pet', 'husky'],
    prototypeQuery: 'pet dog cat animal companion',
    prefetchPriority: 5,
    defaultMemoryLimit: 15,
    decayRate: 0.1,
    relatedTopics: ['family', 'health'],
  },

  // Professional
  {
    id: 'work',
    name: 'Work',
    description: 'Professional work context',
    keywords: ['work', 'job', 'office', 'meeting', 'project', 'deadline'],
    prototypeQuery: 'work job career professional office colleagues',
    prefetchPriority: 7,
    defaultMemoryLimit: 25,
    decayRate: 0.15,
    relatedTopics: ['projects', 'schedule', 'technical'],
  },
  {
    id: 'work/role',
    parentId: 'work',
    name: 'Current Role',
    description: 'Current job and responsibilities',
    keywords: ['role', 'job', 'position', 'responsibilities'],
    prototypeQuery: 'my role job position responsibilities duties',
    prefetchPriority: 6,
    defaultMemoryLimit: 15,
    decayRate: 0.1,
    relatedTopics: ['work', 'identity'],
  },
  {
    id: 'work/colleagues',
    parentId: 'work',
    name: 'Colleagues',
    description: 'People at work',
    keywords: ['colleague', 'coworker', 'teammate', 'boss', 'manager'],
    prototypeQuery: 'colleague coworker teammate work people',
    prefetchPriority: 5,
    defaultMemoryLimit: 20,
    decayRate: 0.2,
    relatedTopics: ['work', 'events/meetings'],
  },
  {
    id: 'projects',
    name: 'Projects',
    description: 'Projects and initiatives',
    keywords: ['project', 'initiative', 'build', 'develop'],
    prototypeQuery: 'project building developing creating initiative',
    prefetchPriority: 7,
    defaultMemoryLimit: 30,
    decayRate: 0.15,
    relatedTopics: ['work', 'technical'],
  },
  {
    id: 'projects/active',
    parentId: 'projects',
    name: 'Active Projects',
    description: 'Currently active projects',
    keywords: ['current', 'working on', 'building', 'developing'],
    prototypeQuery: 'current project active building developing feature',
    prefetchPriority: 8,
    defaultMemoryLimit: 40,
    decayRate: 0.2,
    relatedTopics: ['work', 'technical', 'schedule'],
  },
  {
    id: 'projects/completed',
    parentId: 'projects',
    name: 'Completed Projects',
    description: 'Past completed projects',
    keywords: ['completed', 'finished', 'shipped', 'launched'],
    prototypeQuery: 'completed finished shipped launched past project',
    prefetchPriority: 4,
    defaultMemoryLimit: 15,
    decayRate: 0.25,
    relatedTopics: ['projects', 'history'],
  },
  {
    id: 'technical',
    name: 'Technical',
    description: 'Engineering and technical topics',
    keywords: ['code', 'api', 'database', 'deploy', 'bug', 'feature'],
    prototypeQuery: 'code programming engineering technical development api',
    prefetchPriority: 7,
    defaultMemoryLimit: 30,
    decayRate: 0.2,
    relatedTopics: ['projects/active', 'work', 'agent/learnings'],
  },
  {
    id: 'technical/skills',
    parentId: 'technical',
    name: 'Technical Skills',
    description: 'Programming languages and skills',
    keywords: ['skill', 'language', 'framework', 'expertise'],
    prototypeQuery: 'programming skill language framework expertise',
    prefetchPriority: 5,
    defaultMemoryLimit: 20,
    decayRate: 0.1,
    relatedTopics: ['technical', 'identity'],
  },
  {
    id: 'technical/tools',
    parentId: 'technical',
    name: 'Tools',
    description: 'Development tools and services',
    keywords: ['tool', 'service', 'platform', 'ide'],
    prototypeQuery: 'tool service platform development environment',
    prefetchPriority: 4,
    defaultMemoryLimit: 15,
    decayRate: 0.2,
    relatedTopics: ['technical'],
  },

  // Temporal
  {
    id: 'schedule',
    name: 'Schedule',
    description: 'Calendar, appointments, and time-based events',
    keywords: ['today', 'tomorrow', 'meeting', 'appointment', 'calendar'],
    prototypeQuery: 'schedule calendar meeting appointment today tomorrow',
    prefetchPriority: 9,
    defaultMemoryLimit: 20,
    decayRate: 0.3,
    relatedTopics: ['work', 'events', 'family'],
  },
  {
    id: 'schedule/today',
    parentId: 'schedule',
    name: 'Today',
    description: "Today's schedule",
    keywords: ['today', 'this morning', 'this afternoon', 'tonight'],
    prototypeQuery: 'today schedule plans morning afternoon',
    prefetchPriority: 10,
    defaultMemoryLimit: 15,
    decayRate: 0.5,
    relatedTopics: ['schedule', 'events/meetings'],
  },
  {
    id: 'schedule/week',
    parentId: 'schedule',
    name: 'This Week',
    description: "This week's schedule",
    keywords: ['this week', 'next week', 'weekly'],
    prototypeQuery: 'week weekly schedule plans upcoming',
    prefetchPriority: 8,
    defaultMemoryLimit: 20,
    decayRate: 0.4,
    relatedTopics: ['schedule', 'events'],
  },
  {
    id: 'schedule/upcoming',
    parentId: 'schedule',
    name: 'Upcoming',
    description: 'Future schedule and plans',
    keywords: ['upcoming', 'future', 'planned', 'scheduled'],
    prototypeQuery: 'upcoming future planned scheduled soon',
    prefetchPriority: 7,
    defaultMemoryLimit: 15,
    decayRate: 0.3,
    relatedTopics: ['schedule', 'events'],
  },
  {
    id: 'history',
    name: 'History',
    description: 'Past events and memories',
    keywords: ['past', 'history', 'before', 'previously'],
    prototypeQuery: 'past history before previously remembered',
    prefetchPriority: 4,
    defaultMemoryLimit: 20,
    decayRate: 0.1,
    relatedTopics: ['conversation'],
  },
  {
    id: 'history/recent',
    parentId: 'history',
    name: 'Recent History',
    description: 'Recent past events',
    keywords: ['recently', 'last week', 'few days ago'],
    prototypeQuery: 'recently last week few days ago recent',
    prefetchPriority: 5,
    defaultMemoryLimit: 25,
    decayRate: 0.2,
    relatedTopics: ['history', 'conversation'],
  },
  {
    id: 'events',
    name: 'Events',
    description: 'Events and occasions',
    keywords: ['event', 'meeting', 'conference', 'birthday'],
    prototypeQuery: 'event meeting conference birthday celebration',
    prefetchPriority: 6,
    defaultMemoryLimit: 20,
    decayRate: 0.2,
    relatedTopics: ['schedule', 'family', 'work'],
  },
  {
    id: 'events/meetings',
    parentId: 'events',
    name: 'Meetings',
    description: 'Work meetings and calls',
    keywords: ['meeting', 'standup', 'sync', 'call'],
    prototypeQuery: 'meeting standup sync call video conference',
    prefetchPriority: 7,
    defaultMemoryLimit: 20,
    decayRate: 0.3,
    relatedTopics: ['events', 'work', 'schedule'],
  },
  {
    id: 'events/deadlines',
    parentId: 'events',
    name: 'Deadlines',
    description: 'Deadlines and due dates',
    keywords: ['deadline', 'due date', 'deliverable'],
    prototypeQuery: 'deadline due date deliverable submission milestone',
    prefetchPriority: 8,
    defaultMemoryLimit: 15,
    decayRate: 0.4,
    relatedTopics: ['events', 'projects', 'schedule'],
  },

  // Health
  {
    id: 'health',
    name: 'Health',
    description: 'Physical and mental health topics',
    keywords: ['health', 'exercise', 'doctor', 'sick', 'workout', 'sleep'],
    prototypeQuery: 'health wellness exercise medical doctor symptoms',
    prefetchPriority: 6,
    defaultMemoryLimit: 20,
    decayRate: 0.15,
    relatedTopics: ['preferences', 'schedule'],
  },
  {
    id: 'health/physical',
    parentId: 'health',
    name: 'Physical Health',
    description: 'Exercise, diet, and physical wellness',
    keywords: ['exercise', 'workout', 'diet', 'fitness'],
    prototypeQuery: 'exercise workout fitness diet physical health',
    prefetchPriority: 5,
    defaultMemoryLimit: 15,
    decayRate: 0.15,
    relatedTopics: ['health', 'preferences'],
  },
  {
    id: 'health/mental',
    parentId: 'health',
    name: 'Mental Health',
    description: 'Mental wellness and emotional health',
    keywords: ['stress', 'anxiety', 'mental', 'therapy'],
    prototypeQuery: 'mental health stress anxiety therapy wellness',
    prefetchPriority: 7,
    defaultMemoryLimit: 15,
    decayRate: 0.1,
    relatedTopics: ['health', 'identity'],
  },
  {
    id: 'health/medical',
    parentId: 'health',
    name: 'Medical',
    description: 'Medical conditions and treatments',
    keywords: ['doctor', 'hospital', 'medication', 'treatment'],
    prototypeQuery: 'doctor hospital medical condition treatment',
    prefetchPriority: 6,
    defaultMemoryLimit: 15,
    decayRate: 0.1,
    relatedTopics: ['health', 'schedule'],
  },

  // Preferences
  {
    id: 'preferences',
    name: 'Preferences',
    description: 'User likes, dislikes, and preferences',
    keywords: ['like', 'prefer', 'favorite', 'hate', 'always', 'never'],
    prototypeQuery: 'prefer favorite like dislike always never habit',
    prefetchPriority: 5,
    defaultMemoryLimit: 25,
    decayRate: 0.1,
    relatedTopics: ['identity'],
  },
  {
    id: 'preferences/likes',
    parentId: 'preferences',
    name: 'Likes',
    description: 'Things the user likes',
    keywords: ['like', 'love', 'enjoy', 'favorite'],
    prototypeQuery: 'like love enjoy favorite prefer',
    prefetchPriority: 5,
    defaultMemoryLimit: 20,
    decayRate: 0.1,
    relatedTopics: ['preferences'],
  },
  {
    id: 'preferences/dislikes',
    parentId: 'preferences',
    name: 'Dislikes',
    description: 'Things the user dislikes',
    keywords: ['hate', 'dislike', 'avoid', 'never'],
    prototypeQuery: 'hate dislike avoid never refuse',
    prefetchPriority: 6,
    defaultMemoryLimit: 15,
    decayRate: 0.1,
    relatedTopics: ['preferences'],
  },

  // Identity
  {
    id: 'identity',
    name: 'Identity',
    description: 'Core user identity and background',
    keywords: ['i am', 'my name', 'about me'],
    prototypeQuery: 'identity who am background about myself',
    prefetchPriority: 8,
    defaultMemoryLimit: 30,
    decayRate: 0.05,
    relatedTopics: ['preferences', 'family'],
  },
  {
    id: 'identity/values',
    parentId: 'identity',
    name: 'Values',
    description: 'Personal values and beliefs',
    keywords: ['believe', 'value', 'important', 'principle'],
    prototypeQuery: 'value believe important principle philosophy',
    prefetchPriority: 7,
    defaultMemoryLimit: 15,
    decayRate: 0.05,
    relatedTopics: ['identity'],
  },
  {
    id: 'identity/background',
    parentId: 'identity',
    name: 'Background',
    description: 'Personal history and background',
    keywords: ['grew up', 'childhood', 'hometown', 'history'],
    prototypeQuery: 'background history grew up childhood hometown',
    prefetchPriority: 5,
    defaultMemoryLimit: 20,
    decayRate: 0.05,
    relatedTopics: ['identity', 'family'],
  },

  // Agent
  {
    id: 'agent',
    name: 'Agent',
    description: 'Agent-related topics',
    keywords: ['you', 'yourself', 'rook'],
    prototypeQuery: 'agent assistant you yourself',
    prefetchPriority: 4,
    defaultMemoryLimit: 15,
    decayRate: 0.1,
    relatedTopics: ['agent/self', 'agent/learnings'],
  },
  {
    id: 'agent/self',
    parentId: 'agent',
    name: 'Agent Self',
    description: 'Memories about the agent itself',
    keywords: ['about yourself', 'your', 'you remember'],
    prototypeQuery: 'agent self memory learned discovered about myself',
    prefetchPriority: 4,
    defaultMemoryLimit: 15,
    decayRate: 0.05,
    relatedTopics: ['agent/learnings'],
  },
  {
    id: 'agent/learnings',
    parentId: 'agent',
    name: 'Agent Learnings',
    description: 'Lessons and insights learned by the agent',
    keywords: ['learned', 'lesson', 'insight', 'discovered'],
    prototypeQuery: 'learned lesson insight discovered realization',
    prefetchPriority: 6,
    defaultMemoryLimit: 20,
    decayRate: 0.05,
    relatedTopics: ['agent/self', 'technical'],
  },

  // Conversation
  {
    id: 'conversation',
    name: 'Conversation',
    description: 'Previous conversation context',
    keywords: ['we talked', 'you said', 'last time', 'remember when'],
    prototypeQuery: 'conversation discussed talked mentioned said',
    prefetchPriority: 5,
    defaultMemoryLimit: 20,
    decayRate: 0.3,
    relatedTopics: ['history'],
  },
];

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
