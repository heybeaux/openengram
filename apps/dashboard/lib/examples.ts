/**
 * Example concept-search queries surfaced on the empty `/search` state.
 *
 * Picked to demonstrate the range of questions engram-code can answer —
 * a "where do I extend?" question, a "what is this?" question, and a
 * "how does X work?" question. Constants live here rather than fetched
 * from the API so the empty state stays instant even with no backend.
 */

export interface ExampleQuery {
  query: string;
  hint: string;
}

export const EXAMPLE_QUERIES: ReadonlyArray<ExampleQuery> = [
  {
    query: 'where would I add a payment provider?',
    hint: 'Find the module that owns provider extension points.',
  },
  {
    query: 'what does the ingestion pipeline do?',
    hint: 'Get a subsystem-level overview of how code becomes cards.',
  },
  {
    query: 'how does the LoD switcher work?',
    hint: 'Pull up the component that drives level-of-detail navigation.',
  },
];
