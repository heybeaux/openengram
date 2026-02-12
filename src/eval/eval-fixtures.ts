/**
 * Eval test fixtures — recall queries and expected fragments.
 * Extracted from engram-eval.sh and engram-eval-framework.md.
 */

export interface EvalQuery {
  id: number;
  query: string;
  expectedFragments: string[];
  /** If true, ANY fragment match counts as pass. If false (default), ALL must match. */
  matchAny?: boolean;
}

export const RECALL_QUERIES: EvalQuery[] = [
  { id: 1, query: "Who is Beaux's wife?", expectedFragments: ['Deanna'] },
  { id: 2, query: 'Should we deploy on Friday?', expectedFragments: ['never deploys on Fridays', 'Friday'], matchAny: true },
  { id: 3, query: "Tell me about Beaux's kids", expectedFragments: ['Stella', 'Odin'] },
  { id: 4, query: 'What pet does Beaux have?', expectedFragments: ['husky', 'Kali'], matchAny: true },
  { id: 5, query: 'Where did Beaux study martial arts?', expectedFragments: ['Yantai', 'Muping'], matchAny: true },
  { id: 6, query: "Who was Beaux's Wing Chun master?", expectedFragments: ['Sifu Liu Ping'] },
  { id: 7, query: 'What happened with the database wipe?', expectedFragments: ['prisma migrate dev', '543'] },
  { id: 8, query: 'Who are the Generosity Catalyst co-founders?', expectedFragments: ['Trevan', 'Matt'] },
  { id: 9, query: 'SOC 2 target date', expectedFragments: ['February 2026'] },
  { id: 10, query: 'Does Beaux prefer dark or white chocolate?', expectedFragments: ['white chocolate'] },
  { id: 11, query: "Who was Beaux's roommate in China?", expectedFragments: ['Sascha', 'Ryan'], matchAny: true },
  { id: 12, query: 'What did Sifu say about injuries?', expectedFragments: ['focus on your kicks'] },
  { id: 13, query: "Beaux's philosophy on learning", expectedFragments: ['practice the basics', 'Do the thing'], matchAny: true },
  { id: 14, query: 'Who is Prince Ocean?', expectedFragments: ['7-year-old'] },
  { id: 15, query: 'Someone dying at the academy', expectedFragments: ['Tyler', 'Joe', 'CPR'], matchAny: true },
  { id: 16, query: 'Salesforce app review', expectedFragments: ['resubmission', 'codebase'], matchAny: true },
  { id: 17, query: 'WhaleHawk contact widget', expectedFragments: ['currently in use'] },
  { id: 18, query: 'What model is Beaux using?', expectedFragments: ['Opus', 'claude'], matchAny: true },
  { id: 19, query: 'Dream cycle patterns', expectedFragments: ['pattern', 'Dream Cycle'], matchAny: true },
  { id: 20, query: 'Memory confidence weights', expectedFragments: ['confidence', 'effectiveScore'], matchAny: true },
  { id: 21, query: 'Embedding strategy for memories', expectedFragments: ['re-embed', 're-embedding'], matchAny: true },
  { id: 22, query: 'Friends from Thailand', expectedFragments: ['Jess', 'Sean'] },
  { id: 23, query: 'BBQ Beatdown event', expectedFragments: ['Tiger Muay Thai'] },
  { id: 24, query: 'Agent getting day wrong', expectedFragments: ['day of the week wrong', 'recurring'], matchAny: true },
  { id: 25, query: 'LaunchAgents for engram', expectedFragments: ['engram-embed', 'auto-start'], matchAny: true },
];

export const LATENCY_QUERIES: string[] = [
  "Who is Beaux's wife?",
  'deployment practices',
  'martial arts history',
  'Salesforce security',
  'family members',
  'memory system design',
  'China experiences',
  'agent capabilities',
  'chocolate preferences',
  'co-founders',
  'Wing Chun training',
  'database migration',
  'LaunchAgents setup',
  'Dream Cycle results',
  'embedding strategy',
  'WhaleHawk architecture',
  'BBQ Beatdown',
  'Prince Ocean',
  'roommate in China',
  'Sifu advice',
  'SOC 2 compliance',
  'confidence weights',
  'skill acquisition',
  'pet husky',
  'Thailand friends',
  'app submission',
  'day of week bug',
  'contact widget',
  'model version',
  'pattern synthesis',
];
