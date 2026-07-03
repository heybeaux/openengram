# @openengram/mcp

MCP (Model Context Protocol) server for [Engram](https://github.com/heybeaux/engram) — persistent memory for AI agents. Works with Claude Desktop, Cursor, and any MCP client.

## Features

- **6 Tools**: `engram_remember`, `engram_recall`, `engram_search`, `engram_forget`, `engram_context`, `engram_observe`
- **2 Resources**: `engram://stats`, `engram://context`
- **1 Prompt**: `memory-aware-chat`
- **Security**: Input validation, rate limiting, TLS enforcement for remote backends
- **Offline-resilient**: Graceful degradation when Engram is unreachable
- **Zero disk footprint**: Stateless proxy — stores nothing locally

## Quick Start

### 1. Install

```bash
npm install -g @openengram/mcp
```

### 2. Configure Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

**Cloud (works anywhere — recommended):**

```json
{
  "mcpServers": {
    "engram": {
      "command": "engram-mcp",
      "env": {
        "ENGRAM_API_URL": "https://api.openengram.ai",
        "ENGRAM_API_KEY": "your_api_key",
        "ENGRAM_USER_ID": "your_user_id"
      }
    }
  }
}
```

**Self-hosted (local network):**

```json
{
  "mcpServers": {
    "engram": {
      "command": "engram-mcp",
      "env": {
        "ENGRAM_API_URL": "http://localhost:3001",
        "ENGRAM_API_KEY": "your_api_key",
        "ENGRAM_USER_ID": "your_user_id"
      }
    }
  }
}
```

### 3. Restart Claude Desktop

Quit and reopen Claude Desktop. You should see the Engram tools available in the chat input.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ENGRAM_API_KEY` | ✅ | — | Your Engram API key (`eng_` prefix) |
| `ENGRAM_USER_ID` | ❌ | `Beaux` | User namespace ID |
| `ENGRAM_API_URL` | ❌ | `https://api.openengram.ai` | Engram API URL |
| `ENGRAM_BASE_URL` | ❌ | — | Alias for `ENGRAM_API_URL` |
| `ENGRAM_TIMEOUT_MS` | ❌ | `10000` | Request timeout (ms) |
| `ENGRAM_LOG_LEVEL` | ❌ | `warn` | `debug` / `info` / `warn` / `error` |
| `ENGRAM_MAX_RETRIES` | ❌ | `2` | Retry count for transient failures |
| `ENGRAM_ALLOW_HTTP` | ❌ | `false` | Allow non-localhost HTTP (dev only) |

## Tools

| Tool | Description |
|------|-------------|
| `engram_remember` | Store a memory with optional layer, importance, and tags |
| `engram_recall` | Semantic search across memories with relevance scores |
| `engram_search` | Entity/graph-aware search |
| `engram_forget` | Delete a memory by ID |
| `engram_context` | Generate an LLM-optimized context window |
| `engram_observe` | Auto-extract and store memories from text |

## Development

```bash
git clone https://github.com/heybeaux/engram-mcp.git
cd engram-mcp
npm install
npm run build

# Run locally
ENGRAM_API_KEY=your_key ENGRAM_USER_ID=dev npm run dev
```

## Links

- [Engram](https://github.com/heybeaux/engram) — The memory backend
- [OpenEngram](https://openengram.ai) — Hosted cloud service
- [Dashboard](https://github.com/heybeaux/engram-dashboard) — Web UI for managing memories

## License

MIT
