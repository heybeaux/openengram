# Source Manifest

Every import into this monorepo must record the source repository, branch, source SHA, destination, and import mode.

| Destination        | Source repo                 | Source branch |     Source SHA | Import mode | Imported in | Notes                                               |
| ------------------ | --------------------------- | ------------: | -------------: | ----------- | ----------: | --------------------------------------------------- |
| apps/dashboard     | `heybeaux/engram-dashboard` |        `main` | `09a91ab73f7d` | subtree     |       PR #1 | Imported as first app surface.                      |
| apps/api           | `heybeaux/engram`           |     `staging` | `0f8cc1c57742` | subtree     |       PR #2 | Core API/runtime import. Default branch is staging. |
| packages/client-js | `heybeaux/engram-client`    |        `main` | `4e6d5423cc2f` | subtree     |       PR #5 | TypeScript client package import.                   |
