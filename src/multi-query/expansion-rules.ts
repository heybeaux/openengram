/**
 * Synonym Dictionary
 * 
 * Maps words to their semantic equivalents for rule-based query expansion.
 * Organized by concept category for maintainability.
 */
export const SYNONYM_GROUPS: Record<string, string[]> = {
  // Preference verbs
  'like': ['prefer', 'enjoy', 'love', 'favor', 'appreciate'],
  'dislike': ['hate', 'avoid', 'despise', 'reject', 'oppose'],
  'prefer': ['like', 'favor', 'choose', 'want', 'desire'],
  'enjoy': ['like', 'love', 'appreciate', 'relish', 'savor'],
  'love': ['adore', 'cherish', 'treasure', 'enjoy'],
  'hate': ['despise', 'loathe', 'detest', 'dislike'],
  'want': ['desire', 'wish', 'need', 'would like'],
  
  // Learning verbs
  'learn': ['discover', 'realize', 'understand', 'find out', 'figure out'],
  'understand': ['comprehend', 'grasp', 'get', 'follow', 'see'],
  'remember': ['recall', 'recollect', 'think of', 'bring to mind'],
  'forget': ['overlook', 'miss', 'neglect'],
  'know': ['understand', 'realize', 'aware of', 'familiar with'],
  
  // Action verbs
  'do': ['perform', 'execute', 'accomplish', 'complete', 'carry out'],
  'make': ['create', 'build', 'construct', 'develop', 'produce'],
  'use': ['utilize', 'employ', 'apply', 'leverage'],
  'get': ['obtain', 'acquire', 'receive', 'fetch', 'retrieve'],
  'give': ['provide', 'supply', 'offer', 'deliver'],
  'take': ['grab', 'seize', 'accept', 'receive'],
  'put': ['place', 'set', 'position', 'store'],
  'go': ['travel', 'move', 'proceed', 'head'],
  'come': ['arrive', 'approach', 'reach', 'show up'],
  'start': ['begin', 'initiate', 'launch', 'kick off'],
  'stop': ['end', 'finish', 'halt', 'cease'],
  'try': ['attempt', 'test', 'experiment with'],
  'help': ['assist', 'support', 'aid'],
  
  // Communication verbs
  'say': ['tell', 'mention', 'state', 'express', 'declare'],
  'ask': ['inquire', 'question', 'query', 'request'],
  'tell': ['inform', 'notify', 'advise', 'let know'],
  'write': ['compose', 'draft', 'author', 'document'],
  'read': ['review', 'scan', 'study', 'examine'],
  'talk': ['discuss', 'speak', 'communicate', 'converse'],
  
  // Temporal words
  'today': ['now', 'currently', 'at present', 'right now'],
  'yesterday': ['recently', 'the other day', 'previously'],
  'tomorrow': ['upcoming', 'next day', 'soon'],
  'soon': ['shortly', 'before long', 'presently'],
  'later': ['afterward', 'subsequently', 'following'],
  'before': ['prior to', 'earlier', 'previously'],
  'after': ['following', 'subsequent to', 'later than'],
  'always': ['constantly', 'continuously', 'perpetually'],
  'never': ['not ever', 'at no time', 'not once'],
  'often': ['frequently', 'regularly', 'commonly'],
  'sometimes': ['occasionally', 'now and then', 'periodically'],
  
  // People words
  'friend': ['buddy', 'companion', 'colleague', 'associate', 'pal'],
  'family': ['relatives', 'loved ones', 'household', 'kin'],
  'child': ['kid', 'offspring', 'youngster', 'little one'],
  'children': ['kids', 'offspring', 'youngsters'],
  'parent': ['mom', 'dad', 'mother', 'father'],
  'person': ['individual', 'someone', 'human', 'people'],
  'wife': ['spouse', 'partner'],
  'husband': ['spouse', 'partner'],
  
  // Work words
  'project': ['task', 'work', 'assignment', 'initiative'],
  'meeting': ['call', 'sync', 'standup', 'discussion', 'session'],
  'deploy': ['release', 'ship', 'launch', 'publish', 'roll out'],
  'build': ['create', 'develop', 'construct', 'implement'],
  'fix': ['repair', 'resolve', 'patch', 'correct', 'mend'],
  'bug': ['issue', 'problem', 'defect', 'error', 'glitch'],
  'feature': ['functionality', 'capability', 'enhancement'],
  'test': ['verify', 'validate', 'check', 'examine'],
  'code': ['program', 'software', 'implementation'],
  'work': ['job', 'task', 'project', 'assignment'],
  
  // Importance words
  'important': ['crucial', 'critical', 'vital', 'essential', 'key'],
  'urgent': ['pressing', 'immediate', 'critical', 'time-sensitive'],
  'good': ['great', 'excellent', 'fine', 'nice', 'positive'],
  'bad': ['poor', 'terrible', 'awful', 'negative', 'problematic'],
  'best': ['optimal', 'ideal', 'top', 'finest', 'greatest'],
  'worst': ['poorest', 'lowest', 'most terrible'],
  
  // Quantity words
  'many': ['numerous', 'several', 'multiple', 'lots of'],
  'few': ['some', 'a couple of', 'a handful of'],
  'all': ['every', 'entire', 'whole', 'complete', 'total'],
  'none': ['no', 'zero', 'nothing', 'not any'],
  
  // Location/Position
  'here': ['this place', 'this location'],
  'there': ['that place', 'that location'],
  'near': ['close to', 'nearby', 'adjacent to'],
  'far': ['distant', 'remote', 'away from'],
};

/**
 * Related concept mappings (beyond synonyms)
 * Maps a word to semantically related concepts
 */
export const RELATED_CONCEPTS: Record<string, string[]> = {
  'like': ['preference', 'favorite', 'interest', 'hobby', 'passion'],
  'dislike': ['avoidance', 'aversion', 'pet peeve'],
  'work': ['job', 'career', 'profession', 'occupation', 'employment'],
  'health': ['fitness', 'wellness', 'medical', 'exercise', 'nutrition'],
  'food': ['meal', 'diet', 'eating', 'cooking', 'restaurant', 'recipe'],
  'travel': ['trip', 'vacation', 'journey', 'destination', 'flight', 'hotel'],
  'money': ['finance', 'budget', 'cost', 'price', 'payment', 'expense'],
  'home': ['house', 'apartment', 'residence', 'living space', 'property'],
  'family': ['relatives', 'children', 'spouse', 'parents', 'siblings'],
  'friend': ['friendship', 'relationship', 'social', 'companion'],
  'learn': ['education', 'study', 'knowledge', 'skill', 'training'],
  'memory': ['remember', 'recall', 'past', 'history', 'experience'],
  'future': ['plan', 'goal', 'upcoming', 'tomorrow', 'next'],
  'code': ['programming', 'development', 'software', 'engineering'],
  'deploy': ['release', 'production', 'launch', 'shipping'],
  'meeting': ['call', 'sync', 'standup', 'discussion', 'agenda'],
  'project': ['initiative', 'effort', 'work', 'task', 'assignment'],
  'problem': ['issue', 'challenge', 'difficulty', 'obstacle', 'bug'],
  'solution': ['fix', 'answer', 'resolution', 'workaround'],
  'idea': ['thought', 'concept', 'suggestion', 'proposal'],
  'decision': ['choice', 'determination', 'resolution'],
  'lesson': ['insight', 'learning', 'takeaway', 'realization'],
};

/**
 * Person-specific expansions
 * These are populated dynamically but we provide some defaults
 */
export const DEFAULT_PERSON_EXPANSIONS: Record<string, string[]> = {
  // Common pronoun expansions (for user references)
  'i': ['user', 'me', 'myself'],
  'my': ['user', 'personal', 'own'],
  'me': ['user', 'myself', 'I'],
};

/**
 * Pattern rule interface
 */
export interface PatternRule {
  name: string;
  pattern: RegExp;
  transform: (match: RegExpMatchArray, query: string) => string[];
}

/**
 * Pattern-based transformation rules
 * Each rule matches a query pattern and generates semantic variants
 */
export const PATTERN_RULES: PatternRule[] = [
  // "What does X like/prefer/enjoy?" → preferences, favorites, interests
  {
    name: 'preference-query',
    pattern: /what (?:does|did) (\w+) (like|prefer|enjoy|love|want)/i,
    transform: (match) => {
      const person = match[1];
      return [
        `${person} preferences`,
        `${person} favorites`,
        `${person} interests`,
        `things ${person} enjoys`,
        `${person} hobbies`,
        `what ${person} dislikes`, // Inverse
      ];
    },
  },

  // "Tell me about X" → details, information, background
  {
    name: 'tell-about',
    pattern: /tell me about (.+)/i,
    transform: (match) => {
      const topic = match[1].trim();
      return [
        `${topic} details`,
        `${topic} information`,
        `${topic} background`,
        `${topic} overview`,
        `who is ${topic}`,
        `what is ${topic}`,
      ];
    },
  },

  // "How do I X?" → guide, steps, process
  {
    name: 'how-to',
    pattern: /how (?:do|can|should|would) I (.+)/i,
    transform: (match) => {
      const action = match[1].trim();
      return [
        `${action} guide`,
        `${action} steps`,
        `${action} process`,
        `${action} instructions`,
        `${action} best practices`,
      ];
    },
  },

  // "When did X happen?" → date, time, timeline
  {
    name: 'when-query',
    pattern: /when (?:did|was|were|is) (.+)/i,
    transform: (match) => {
      const event = match[1].trim();
      return [
        `${event} date`,
        `${event} time`,
        `${event} timeline`,
        `${event} schedule`,
      ];
    },
  },

  // "Why does X?" → reason, cause, explanation
  {
    name: 'why-query',
    pattern: /why (?:does|did|is|was|are|were) (.+)/i,
    transform: (match) => {
      const topic = match[1].trim();
      return [
        `${topic} reason`,
        `${topic} cause`,
        `${topic} explanation`,
        `${topic} motivation`,
      ];
    },
  },

  // "Where is X?" → location, place, find
  {
    name: 'where-query',
    pattern: /where (?:is|are|was|were|can I find) (.+)/i,
    transform: (match) => {
      const thing = match[1].trim();
      return [
        `${thing} location`,
        `${thing} place`,
        `find ${thing}`,
        `${thing} stored`,
      ];
    },
  },

  // "What happened with/to X?" → events, incident, situation
  {
    name: 'what-happened',
    pattern: /what happened (?:with|to|about|regarding) (.+)/i,
    transform: (match) => {
      const topic = match[1].trim();
      return [
        `${topic} events`,
        `${topic} incident`,
        `${topic} situation`,
        `${topic} story`,
        `${topic} update`,
      ];
    },
  },

  // "Remember when X?" → memory, happened, time
  {
    name: 'remember-when',
    pattern: /remember when (.+)/i,
    transform: (match) => {
      const event = match[1].trim();
      return [
        event, // Direct search
        `${event} memory`,
        `${event} happened`,
        `${event} time`,
      ];
    },
  },

  // "X best practices" → guidelines, recommendations, tips
  {
    name: 'best-practices',
    pattern: /(.+) best practices/i,
    transform: (match) => {
      const topic = match[1].trim();
      return [
        `${topic} guidelines`,
        `${topic} recommendations`,
        `${topic} tips`,
        `${topic} advice`,
        `${topic} lessons`,
      ];
    },
  },

  // "Problems with X" / "Issues with X" → bugs, errors, failures
  {
    name: 'problems-with',
    pattern: /(?:problems?|issues?|troubles?) with (.+)/i,
    transform: (match) => {
      const topic = match[1].trim();
      return [
        `${topic} bugs`,
        `${topic} errors`,
        `${topic} failures`,
        `${topic} difficulties`,
        `fix ${topic}`,
      ];
    },
  },

  // "What do I know about X?" → knowledge, information, details
  {
    name: 'what-know',
    pattern: /what do I know about (.+?)\??$/i,
    transform: (match) => {
      const topic = match[1].trim().replace(/\?+$/, '');
      return [
        `${topic}`,
        `${topic} details`,
        `${topic} information`,
        `${topic} facts`,
      ];
    },
  },

  // "What did I learn?" → lessons, insights, discoveries
  {
    name: 'what-learn',
    pattern: /what (?:did|have) I (?:learn|learned|discovered)/i,
    transform: () => [
      'lessons learned',
      'insights',
      'discoveries',
      'realizations',
      'takeaways',
    ],
  },

  // "Who is X?" → person, about, details
  {
    name: 'who-is',
    pattern: /who is (.+?)\??$/i,
    transform: (match) => {
      const person = match[1].trim().replace(/\?+$/, '');
      return [
        `${person}`,
        `about ${person}`,
        `${person} details`,
        `${person} information`,
      ];
    },
  },

  // "What is X?" → definition, explanation, description
  {
    name: 'what-is',
    pattern: /what is (.+?)\??$/i,
    transform: (match) => {
      const thing = match[1].trim().replace(/\?+$/, '');
      return [
        `${thing}`,
        `${thing} definition`,
        `${thing} explanation`,
        `${thing} description`,
      ];
    },
  },
];

/**
 * Normalize a query for deduplication
 * - Lowercase
 * - Remove punctuation
 * - Sort words (bag of words)
 */
export function normalizeQuery(query: string): string {
  return query
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .sort()
    .join(' ');
}

/**
 * Deduplicate query variants that are too similar
 */
export function deduplicateSimilarQueries(queries: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const query of queries) {
    const normalized = normalizeQuery(query);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      unique.push(query);
    }
  }

  return unique;
}
