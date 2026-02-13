# Module Quality Grades

Graded on test coverage, known issues, and code maturity. Updated 2026-02-12.

| Module | Grade | Tests | Notes |
|--------|-------|-------|-------|
| memory | A | 9 spec files / 13 source | Well-tested core module, good coverage |
| deduplication | A | 6 / 8 | Thorough test suite |
| prefetch | A | 5 / 6 | Good coverage (fixed infinite loop bug) |
| multi-query | A | 4 / 6 | Solid test coverage |
| graph | B+ | 4 / 8 | Good but some providers untested |
| hierarchy | B+ | 3 / 5 | Core logic tested |
| ensemble | B | 2 / 8 | Critical module, needs more test coverage |
| clustering | A | 2 / 2 | Fully covered |
| consolidation | B+ | 2 / 3 | Good coverage |
| vector | B | 2 / 5 | Core ops tested, gaps in edge cases |
| reembedding | B | 2 / 4 | Adequate |
| llm | C | 1 / 8 | Under-tested for its importance |
| analytics | B | 1 / 4 | Basic coverage |
| correction | B | 1 / 2 | Adequate |
| fog-index | B | 1 / 3 | Basic coverage |
| memory-access-log | B | 1 / 3 | Adequate |
| memory-pool | B | 1 / 2 | Adequate |
| monitoring | B | 1 / 3 | Basic coverage |
| rate-limit | B | 1 / 3 | Adequate |
| scoped-context | B | 1 / 2 | Adequate |
| summarization | B | 1 / 3 | Basic coverage |
| agent | B | 1 / 4 | Basic coverage |
| agent-session | B | 1 / 2 | Adequate |
| common | B | 1 / 2 | Guard tested |
| eval | B | 1 / 3 | Basic coverage |
| utils | A | 1 / 1 | Fully covered |
| auto | F | 0 / 5 | **No tests** |
| dashboard | F | 0 / 3 | **No tests** |
| health | D | 0 / 3 | No tests (low risk) |
| webhook | F | 0 / 0+ | **No tests** |
| feedback | D | 0 / 0 | Empty module |
| user | D | 0 / 0 | Empty/minimal |
| session | D | 0 / 0 | Empty/minimal |
| prisma | D | 0 / 1 | Shared service, tested indirectly |

## Priority Improvements
1. **ensemble** (B → A) — Critical retrieval module, only 2/8 files tested
2. **llm** (C → B) — Core dependency, only 1/8 files tested
3. **auto** (F → B) — Active module with zero tests
4. **dashboard** (F → B) — Active module with zero tests
