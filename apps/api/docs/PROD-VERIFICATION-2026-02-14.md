# Production Verification — 2026-02-14

Run at: 2026-02-14 ~09:00 PST

## 1. Marketing Site (openengram.ai)

### 1.1 Homepage status
```
curl -s -o /dev/null -w "%{http_code}" https://openengram.ai
→ 200
```
✅ PASS

### 1.2 Renders real content
```
curl -s https://openengram.ai | head -50
→ <!DOCTYPE html>... <title>Engram — Memory Infrastructure for AI Agents</title>
  Full landing page with nav, hero, features, ecosystem sections
```
✅ PASS

### 1.3 Pricing section
```
curl -s https://openengram.ai | grep -i "pricing"
→ <section id="pricing">... Free ($0), Starter ($9), Pro ($39), Scale ($99)
```
✅ PASS

### 1.4 llms.txt
```
curl -s -o /dev/null -w "%{http_code}" https://openengram.ai/llms.txt
→ 404
```
❌ FAIL — llms.txt not deployed

### 1.5 Schema.org markup
```
curl -s https://openengram.ai | grep -i "schema.org"
→ (no output)
```
❌ FAIL — No Schema.org markup found in page source

---

## 2. Dashboard (app.openengram.ai)

### 2.1 /login
```
curl -s -o /dev/null -w "%{http_code}" https://app.openengram.ai/login
→ 200
```
✅ PASS

### 2.2 /signup
```
curl -s -o /dev/null -w "%{http_code}" https://app.openengram.ai/signup
→ 200
```
✅ PASS

### 2.3 /status
```
curl -s -o /dev/null -w "%{http_code}" https://app.openengram.ai/status
→ 200
```
✅ PASS

### 2.4 /settings
```
curl -s -o /dev/null -w "%{http_code}" https://app.openengram.ai/settings
→ 307 (redirect)
```
✅ PASS — redirects as expected (likely to login)

### 2.5 No localhost references
```
curl -s https://app.openengram.ai/login | grep -i "localhost"
→ No localhost references found
```
✅ PASS

---

## 3. API (api.openengram.ai)

### 3.1 Health
```
curl -s https://api.openengram.ai/v1/health
→ {"status":"degraded","uptime":64,"dependencies":{"database":{"status":"up","latencyMs":419,"memoryCount":14},"engramEmbed":{"status":"down"}},...}
```
⚠️ PARTIAL — Health endpoint works (200), but status is "degraded" because engramEmbed is down. Database is up.

### 3.2a Register
```
curl -s -X POST https://api.openengram.ai/v1/auth/register -H "Content-Type: application/json" \
  -d '{"email":"prodtest-1771088343@test.openengram.ai","password":"TestPass123!","name":"Prod Test"}'
→ {"token":"eyJ...","apiKey":"eng_df45...","account":{"id":"cmlmk9sy7...","email":"prodtest-...","name":"Prod Test","plan":"FREE","createdAt":"2026-02-14T16:59:04.783Z"},"agent":{...}}
```
✅ PASS

### 3.2b Login
```
curl -s -X POST https://api.openengram.ai/v1/auth/login -H "Content-Type: application/json" \
  -d '{"email":"prodtest-1771088343@test.openengram.ai","password":"TestPass123!"}'
→ {"token":"eyJ...","apiKey":"eng_df45...3686","account":{...}}
```
✅ PASS

### 3.2c POST /v1/memories/search (API key)
```
curl -s -X POST https://api.openengram.ai/v1/memories/search \
  -H "X-AM-API-Key: eng_df45..." -H "X-AM-User-ID: cmlmk9sy7..." \
  -d '{"query":"test"}'
→ {"statusCode":500,"message":"Internal server error"}
  HTTP_CODE: 500
```
❌ FAIL — Not 404 (route exists), but returns 500. Likely due to engramEmbed being down (no embedding service for search).

### 3.2d PATCH /v1/account
```
curl -s -X PATCH https://api.openengram.ai/v1/account \
  -H "Authorization: Bearer $JWT" -d '{"name":"Prod Test Updated"}'
→ {"id":"...","name":"Prod Test Updated","plan":"FREE",...}
  HTTP_CODE: 200
```
✅ PASS — Not 404, returns updated account

### 3.2e Create memory — createdAt format
```
curl -s -X POST https://api.openengram.ai/v1/memories \
  -H "X-AM-API-Key: eng_df45..." -H "X-AM-User-ID: cmlmk9sy7..." \
  -d '{"content":"Production verification test memory"}'
→ {...,"createdAt":"2026-02-14T16:59:34.961Z",...}
```
✅ PASS — createdAt is ISO string, not `{}`

### 3.2f DELETE /v1/account/api-keys/:id
```
curl -s -X DELETE https://api.openengram.ai/v1/account/api-keys/cmlmk9t270002oe012rsb0j04 \
  -H "Authorization: Bearer $JWT"
→ HTTP_CODE: 204
```
✅ PASS — Not 404, returns 204 No Content

### 3.2g Rate limiting
```
10 rapid register calls:
→ All 10 returned 201
```
❌ FAIL — No rate limiting triggered. All 10 registration requests succeeded without 429.

---

## 4. Cross-surface check

### 4.1 No localhost in dashboard
```
curl -s https://app.openengram.ai/login | grep -i "localhost"
→ No localhost references found
```
✅ PASS

---

## Summary

| Surface | Tests | Pass | Fail/Partial |
|---------|-------|------|-------------|
| Marketing site | 5 | 3 | 2 (llms.txt, Schema.org) |
| Dashboard | 5 | 5 | 0 |
| API | 8 | 5 | 3 (search 500, rate limit, health degraded) |
| Cross-surface | 1 | 1 | 0 |
| **Total** | **19** | **14** | **5** |

### Issues to address:
1. **llms.txt** — Not deployed to marketing site (404)
2. **Schema.org markup** — Not present in marketing site HTML
3. **Memory search returns 500** — engramEmbed service is down, causing search failures
4. **Rate limiting not working** — 10 rapid register calls all succeeded (expected 429)
5. **Health status degraded** — engramEmbed dependency is down
