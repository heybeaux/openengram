# Known Issues

## AgentId Format Inconsistency

**Status:** Documented, not yet fixed. Do not run migrations without coordination.

### Problem

The `agentId` field on memories has inconsistent formats:

- **From local sync:** Prisma CUID (e.g., `cmllz86ff0002kd01v5wqqiy4`) — these are the `Agent.id` primary key values.
- **From API creation:** Human-readable identifier (e.g., `"kit"`, `"rook"`) — these are the `Agent.identifier` values.

This means filtering memories by `agentId` may miss results depending on which format was used at creation time. The listing endpoint's `agentId` query parameter cannot reliably match both formats.

### Proper Fix

1. **Normalize `agentId`** to always store the human-readable `Agent.identifier` (e.g., `"rook"`, `"kit"`), not the Prisma CUID.
2. **Migration:** Update all existing memories where `agentId` is a CUID to use the corresponding `Agent.identifier` instead.
3. **Fix sync code** that writes CUIDs as `agentId` to write identifiers instead.
4. **Fix API code** (if any) that resolves `agentId` from the Agent record's `id` field instead of `identifier`.

### Workaround

Until the migration is run, queries filtering by `agentId` may need to resolve both the identifier and the CUID and filter by either.
