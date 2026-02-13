# Engram Quickstart

Get Engram running in one command.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) & Docker Compose

## Setup

```bash
git clone https://github.com/heybeaux/engram && cd engram
cp .env.example .env
# Edit .env if you want to set an API key or use OpenAI embeddings
docker compose up -d
```

## Verify

```bash
curl http://localhost:3001/v1/health
```

## Create a Memory

```bash
curl -X POST http://localhost:3001/v1/memories \
  -H "Content-Type: application/json" \
  -H "X-AM-User-ID: demo" \
  -d '{"raw": "The user prefers dark mode"}'
```

## Search Memories

```bash
curl -X POST http://localhost:3001/v1/memories/search \
  -H "Content-Type: application/json" \
  -H "X-AM-User-ID: demo" \
  -d '{"query": "UI preferences", "limit": 5}'
```

## Embedding Options

By default, Engram is configured for the local `engram-embed` service. To use it, uncomment the `engram-embed` service in `docker-compose.yml`.

Alternatively, set these in `.env` to use OpenAI:

```
EMBEDDING_PROVIDER=openai
OPENAI_API_KEY=sk-...
```
