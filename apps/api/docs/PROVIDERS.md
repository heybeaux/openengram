# Providers

Engram supports multiple LLM and vector storage providers. Choose based on your needs.

---

## LLM Providers

Engram uses LLMs for two purposes:
1. **Extraction** — Analyzing text to extract 5W1H structure
2. **Embeddings** — Converting text to vectors for semantic search

### Comparison

| Provider | Quality | Speed | Cost | Embeddings | Local |
|----------|---------|-------|------|------------|-------|
| OpenAI | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | $$ | ✓ | ✗ |
| Anthropic | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | $$ | ✗ | ✗ |
| Ollama | ⭐⭐⭐⭐ | ⭐⭐⭐ | Free | ✓ | ✓ |
| LM Studio | ⭐⭐⭐⭐ | ⭐⭐⭐ | Free | ✓ | ✓ |

---

## OpenAI

Best all-around choice. Fast, high quality, supports embeddings.

### Setup

```bash
LLM_PROVIDER="openai"
LLM_MODEL="gpt-4o-mini"
EMBEDDING_PROVIDER="openai"
OPENAI_API_KEY="sk-..."
```

### Models

| Model | Use Case | Cost |
|-------|----------|------|
| `gpt-4o-mini` | Default, good balance | $0.15/1M input |
| `gpt-4o` | Best quality | $2.50/1M input |
| `gpt-3.5-turbo` | Budget option | $0.50/1M input |

### Embedding Models

| Model | Dimensions | Cost |
|-------|------------|------|
| `text-embedding-3-small` | 1536 | $0.02/1M tokens |
| `text-embedding-3-large` | 3072 | $0.13/1M tokens |

**Note:** Engram uses `text-embedding-3-small` by default.

### Features

- ✓ Chat completions
- ✓ JSON mode for structured output
- ✓ Embeddings
- ✓ High rate limits
- ✓ Excellent extraction quality

---

## Anthropic

Best extraction quality. Use with OpenAI for embeddings.

### Setup

```bash
LLM_PROVIDER="anthropic"
LLM_MODEL="claude-3-5-sonnet-20241022"
ANTHROPIC_API_KEY="sk-ant-..."

# Anthropic doesn't support embeddings, use OpenAI
EMBEDDING_PROVIDER="openai"
OPENAI_API_KEY="sk-..."
```

### Models

| Model | Use Case | Cost |
|-------|----------|------|
| `claude-3-5-sonnet-20241022` | Best balance | $3/1M input |
| `claude-3-opus-20240229` | Highest quality | $15/1M input |
| `claude-3-haiku-20240307` | Fast & cheap | $0.25/1M input |

### Features

- ✓ Chat completions
- ✓ Excellent reasoning
- ✓ Better at nuanced extraction
- ✗ No embeddings (use OpenAI or local)

### JSON Output

Claude sometimes wraps JSON in markdown code blocks. Engram handles this automatically.

---

## Ollama

Run models locally. Free, private, no API limits.

### Setup

1. Install Ollama: https://ollama.com/download

2. Pull required models:
```bash
ollama pull llama3.2          # For chat/extraction
ollama pull nomic-embed-text  # For embeddings
```

3. Configure Engram:
```bash
LLM_PROVIDER="ollama"
LLM_MODEL="llama3.2"
EMBEDDING_PROVIDER="ollama"
OLLAMA_URL="http://localhost:11434"  # Default
```

### Models

| Model | Parameters | RAM | Use Case |
|-------|------------|-----|----------|
| `llama3.2` | 3B | 4GB | Fast, good quality |
| `llama3.1` | 8B | 8GB | Better quality |
| `mistral` | 7B | 8GB | Good alternative |
| `phi3` | 3.8B | 4GB | Very fast |

### Embedding Models

| Model | Dimensions | RAM |
|-------|------------|-----|
| `nomic-embed-text` | 768 | 1GB |
| `mxbai-embed-large` | 1024 | 2GB |

### Features

- ✓ Fully local (no internet needed)
- ✓ Free (no API costs)
- ✓ Private (data stays local)
- ✓ Supports embeddings
- ⚠ Requires capable hardware
- ⚠ Slower than cloud APIs

### JSON Mode

Ollama has native JSON mode that Engram uses automatically:

```typescript
// Internally uses: format: 'json'
```

---

## LM Studio

GUI for running local models. OpenAI-compatible API.

### Setup

1. Download LM Studio: https://lmstudio.ai/

2. Load a model in the GUI

3. Start the local server (toggle in bottom left)

4. Configure Engram:
```bash
LLM_PROVIDER="lmstudio"
LLM_MODEL="local-model"
EMBEDDING_PROVIDER="lmstudio"
LMSTUDIO_URL="http://localhost:1234/v1"  # Default
```

### Features

- ✓ Easy model management
- ✓ GPU acceleration
- ✓ OpenAI-compatible API
- ✓ Visual interface
- ⚠ Must keep GUI running
- ⚠ Embedding model must be loaded separately

### Recommended Models

Download from LM Studio's model library:
- **Chat:** Llama 3, Mistral, Phi-3
- **Embeddings:** nomic-embed-text-v1.5

---

## Vector Providers

### Comparison

| Provider | Scale | Cost | Setup | Latency |
|----------|-------|------|-------|---------|
| pgvector | 1M vectors | Free | Easy | 10-50ms |
| Pinecone | Billions | $$ | Easy | 5-20ms |

---

## pgvector

PostgreSQL extension for vector storage. Default and recommended for most use cases.

### Setup

pgvector comes bundled with Engram's Prisma schema. Just run safe migrations:

```bash
pnpm run migrate:deploy
```

Never run `prisma migrate dev` or `prisma migrate reset` against a real/shared database.

### Configuration

```bash
VECTOR_PROVIDER="pgvector"  # Default, no other config needed
```

### Features

- ✓ No additional service
- ✓ Free
- ✓ Simple backups (part of Postgres)
- ✓ Transactions with metadata
- ⚠ Performance drops past ~1M vectors
- ⚠ Uses database resources

### Performance Tips

For better performance with large datasets:

```sql
-- Create HNSW index for faster searches
CREATE INDEX ON memories 
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
```

---

## Pinecone

Cloud-native vector database. Use for large scale deployments.

### Setup

1. Create account: https://www.pinecone.io/

2. Create an index:
   - Name: `engram`
   - Dimensions: `1536` (for OpenAI)
   - Metric: `cosine`

3. Configure Engram:
```bash
VECTOR_PROVIDER="pinecone"
PINECONE_API_KEY="pcsk_..."
PINECONE_INDEX="engram"
```

### Features

- ✓ Scales to billions of vectors
- ✓ Fast queries at any scale
- ✓ Managed (no maintenance)
- ✓ Metadata filtering
- $$ Costs money
- ⚠ External dependency

### Pricing

| Tier | Vectors | Cost |
|------|---------|------|
| Starter | 100K | Free |
| Standard | 1M+ | $70/mo+ |

### Dimension Matching

Your Pinecone index dimensions must match your embedding model:

| Embedding Model | Dimensions |
|-----------------|------------|
| OpenAI `text-embedding-3-small` | 1536 |
| OpenAI `text-embedding-3-large` | 3072 |
| Ollama `nomic-embed-text` | 768 |

---

## Provider Selection Guide

### I want simplicity
→ **OpenAI** for both LLM and embeddings, **pgvector** for storage

### I want best quality
→ **Anthropic** for LLM, **OpenAI** for embeddings, **pgvector** for storage

### I want privacy / local-only
→ **Ollama** for both LLM and embeddings, **pgvector** for storage

### I have millions of users
→ **OpenAI** for LLM and embeddings, **Pinecone** for storage

### I'm on a budget
→ **Ollama** for everything (requires decent hardware)

---

## Mixing Providers

Engram lets you mix providers for optimal results:

```bash
# Best extraction + cheap embeddings
LLM_PROVIDER="anthropic"
LLM_MODEL="claude-3-5-sonnet-20241022"
EMBEDDING_PROVIDER="openai"
OPENAI_API_KEY="sk-..."
ANTHROPIC_API_KEY="sk-ant-..."

# Or: local extraction + cloud embeddings
LLM_PROVIDER="ollama"
LLM_MODEL="llama3.2"
EMBEDDING_PROVIDER="openai"
OPENAI_API_KEY="sk-..."
```
