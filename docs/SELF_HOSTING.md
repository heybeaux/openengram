# Self-Hosting Guide

Run Engram on your own infrastructure.

---

## Requirements

- **Node.js** 18+ (20+ recommended)
- **PostgreSQL** 14+ with pgvector extension
- **pnpm** (or npm/yarn)

---

## Quick Start

### 1. Clone and Install

```bash
git clone https://github.com/your-org/engram
cd engram
pnpm install
```

### 2. Set Up Database

**Option A: Docker (easiest)**

```bash
docker run -d \
  --name engram-db \
  -e POSTGRES_USER=engram \
  -e POSTGRES_PASSWORD=secret \
  -e POSTGRES_DB=engram \
  -p 5432:5432 \
  ankane/pgvector
```

**Option B: Existing Postgres**

Enable pgvector extension:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

### 3. Configure Environment

```bash
cp .env.example .env
```

Edit `.env`:

```bash
DATABASE_URL="postgresql://engram:secret@localhost:5432/engram"
LLM_PROVIDER="openai"
OPENAI_API_KEY="sk-..."
```

### 4. Run Migrations

```bash
pnpm prisma migrate dev
```

### 5. Start Server

```bash
# Development
pnpm start:dev

# Production
pnpm build
pnpm start:prod
```

Server runs at `http://localhost:3000`

---

## Creating API Keys

API keys are stored hashed in the database. You'll need to create one for your agent.

### Generate an API Key

```bash
# Generate a random key
openssl rand -hex 32
# Example output: a1b2c3d4e5f6...

# Prefix it with eg_sk_
# Final key: eg_sk_a1b2c3d4e5f6...
```

### Store in Database

```sql
INSERT INTO agents (id, name, api_key_hash, api_key_hint, created_at, updated_at)
VALUES (
  'agent_1',
  'My Agent',
  encode(sha256('eg_sk_a1b2c3d4e5f6...'::bytea), 'hex'),
  '...f6',  -- Last 4 chars for identification
  NOW(),
  NOW()
);
```

### Or Use Prisma Studio

```bash
pnpm prisma studio
```

Then add the agent manually in the UI.

---

## Production Deployment

### Docker

```dockerfile
# Dockerfile
FROM node:20-alpine

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy package files
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Copy source
COPY . .

# Build
RUN pnpm build
RUN pnpm prisma generate

# Run
CMD ["pnpm", "start:prod"]
```

```yaml
# docker-compose.yml
version: '3.8'
services:
  engram:
    build: .
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=postgresql://engram:secret@db:5432/engram
      - LLM_PROVIDER=openai
      - OPENAI_API_KEY=${OPENAI_API_KEY}
    depends_on:
      - db

  db:
    image: ankane/pgvector
    environment:
      - POSTGRES_USER=engram
      - POSTGRES_PASSWORD=secret
      - POSTGRES_DB=engram
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

```bash
docker-compose up -d
```

### Railway / Render / Fly.io

1. Connect your repository
2. Set environment variables in the dashboard
3. Deploy

Most platforms auto-detect NestJS and configure correctly.

### Kubernetes

```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: engram
spec:
  replicas: 2
  selector:
    matchLabels:
      app: engram
  template:
    metadata:
      labels:
        app: engram
    spec:
      containers:
      - name: engram
        image: your-registry/engram:latest
        ports:
        - containerPort: 3000
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: engram-secrets
              key: database-url
        - name: OPENAI_API_KEY
          valueFrom:
            secretKeyRef:
              name: engram-secrets
              key: openai-api-key
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
---
apiVersion: v1
kind: Service
metadata:
  name: engram
spec:
  selector:
    app: engram
  ports:
  - port: 80
    targetPort: 3000
```

---

## Database Setup

### PostgreSQL with pgvector

**Docker:**

```bash
docker run -d \
  --name engram-db \
  -e POSTGRES_USER=engram \
  -e POSTGRES_PASSWORD=secret \
  -e POSTGRES_DB=engram \
  -p 5432:5432 \
  -v pgdata:/var/lib/postgresql/data \
  ankane/pgvector
```

**Native installation:**

```bash
# Ubuntu
sudo apt install postgresql-14-pgvector

# macOS
brew install pgvector
```

Then enable:

```sql
CREATE EXTENSION vector;
```

### Managed Databases

Most managed Postgres services support pgvector:

- **Supabase** — Built-in
- **Neon** — Built-in
- **Railway** — Use pgvector template
- **AWS RDS** — Enable extension
- **Google Cloud SQL** — Enable extension

---

## Running Fully Local

For complete privacy with no cloud dependencies:

### 1. Install Ollama

```bash
# macOS
brew install ollama

# Linux
curl -fsSL https://ollama.com/install.sh | sh
```

### 2. Pull Models

```bash
ollama pull llama3.2
ollama pull nomic-embed-text
```

### 3. Configure Engram

```bash
DATABASE_URL="postgresql://engram:secret@localhost:5432/engram"
LLM_PROVIDER="ollama"
LLM_MODEL="llama3.2"
EMBEDDING_PROVIDER="ollama"
OLLAMA_URL="http://localhost:11434"
VECTOR_PROVIDER="pgvector"
```

### 4. Start Everything

```bash
# Terminal 1: Ollama
ollama serve

# Terminal 2: Engram
pnpm start:dev
```

---

## Scaling

### Horizontal Scaling

Engram is stateless — run multiple instances behind a load balancer.

```yaml
# docker-compose for multiple instances
services:
  engram-1:
    build: .
    # ...
  engram-2:
    build: .
    # ...
  nginx:
    image: nginx
    ports:
      - "80:80"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
```

### Database Scaling

For high read loads:
- Add read replicas
- Use connection pooling (PgBouncer)

For vector search at scale:
- Switch from pgvector to Pinecone
- Or use pgvector with HNSW indexes

### Caching

Add Redis for caching frequent queries:

```bash
# Future feature
REDIS_URL="redis://localhost:6379"
```

---

## Monitoring

### Health Check

```bash
curl http://localhost:3000/health
# {"status":"ok"}
```

### Logs

```bash
# Development
pnpm start:dev

# Production (JSON logs)
NODE_ENV=production pnpm start:prod
```

### Metrics

Coming soon: Prometheus metrics at `/metrics`

---

## Security

### API Key Handling

- API keys are hashed with SHA-256 before storage
- Never log or expose full API keys
- Rotate keys periodically

### Network

- Use HTTPS in production
- Put behind a reverse proxy (nginx, Caddy)
- Use firewall rules to restrict database access

### Rate Limiting

Configure per-agent limits in the database:

```sql
UPDATE agents 
SET requests_per_day = 10000 
WHERE id = 'agent_1';
```

---

## Backup & Recovery

### Database Backup

```bash
# Backup
pg_dump -Fc engram > backup.dump

# Restore
pg_restore -d engram backup.dump
```

### With Docker

```bash
docker exec engram-db pg_dump -U engram engram > backup.sql
```

### Pinecone

Pinecone handles backups automatically. For extra safety, export your index periodically.

---

## Troubleshooting

### "relation does not exist"

Run migrations:

```bash
pnpm prisma migrate dev
```

### "pgvector extension not found"

Install and enable pgvector:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

### "Connection refused" to Ollama

Make sure Ollama is running:

```bash
ollama serve
```

### High memory usage

- Reduce `LLM_MODEL` size
- Add connection pooling
- Limit concurrent requests

### Slow vector search

Add an HNSW index:

```sql
CREATE INDEX ON memories 
USING hnsw (embedding vector_cosine_ops);
```
