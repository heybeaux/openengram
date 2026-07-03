# Source Manifest

Every import into this monorepo must record the source repository, branch, source SHA, destination, and import mode.

| Destination                   | Source repo                            | Source branch |     Source SHA | Import mode | Imported in | Notes                                                                                                                                |
| ----------------------------- | -------------------------------------- | ------------: | -------------: | ----------- | ----------: | ------------------------------------------------------------------------------------------------------------------------------------ |
| apps/dashboard                | `heybeaux/engram-dashboard`            |        `main` | `09a91ab73f7d` | subtree     |       PR #1 | Imported as first app surface.                                                                                                       |
| apps/api                      | `heybeaux/engram`                      |     `staging` | `0f8cc1c57742` | subtree     |       PR #2 | Core API/runtime import. Default branch is staging.                                                                                  |
| packages/client-js            | `heybeaux/engram-client`               |        `main` | `4e6d5423cc2f` | subtree     |       PR #5 | TypeScript client package import.                                                                                                    |
| packages/mcp                  | `heybeaux/engram-mcp`                  |        `main` | `f36f6648b3b6` | subtree     |       PR #6 | MCP server package import.                                                                                                           |
| packages/channel-intelligence | `heybeaux/engram-channel-intelligence` |      `master` | `62416ecf2125` | subtree     |       PR #7 | Channel intelligence package import.                                                                                                 |
| apps/code-api                 | `heybeaux/engram-code`                 |        `main` | `6d5b72317cea` | subtree     |       PR #9 | Code-intel NestJS app. Imported in PR #9; isolated CI added in PR #12; root workspace added in PR #13; Turbo app checks in progress. |
| services/embed                | `heybeaux/engram-embed`                |        `main` | `2d917adeb796` | subtree     |      PR #10 | Rust embedding service. Imported in PR #10; isolated Rust CI added in PR #11; outside JS workspace by design.                        |
