# Feedback API

## `POST /v1/feedback`

Submit user feedback. Requires JWT authentication (Bearer token).

**Rate limit:** 10 requests per minute.

### Request Body

| Field      | Type   | Required | Description                                      |
|------------|--------|----------|--------------------------------------------------|
| `rating`   | integer | ✅       | Rating from **0** to **10** (inclusive)           |
| `category` | string | ✅       | One of: `bug`, `feature`, `general`, `nps`       |
| `text`     | string | ❌       | Free-text feedback message                       |
| `page`     | string | ❌       | Page or context where feedback was submitted from |

### Validation Rules

- `rating` must be an integer, minimum 0, maximum 10
- `category` must be exactly one of: `bug`, `feature`, `general`, `nps`
- `text` is optional; if provided, must be a string
- `page` is optional; if provided, must be a string

### Example Request

```bash
curl -X POST https://api.openengram.ai/v1/feedback \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "rating": 8,
    "category": "feature",
    "text": "Would love to see memory search filters",
    "page": "/dashboard"
  }'
```

### Example Response

```json
{
  "id": "fb_abc123",
  "status": "received"
}
```

**Status:** `201 Created`

### Error Responses

- `400` — Validation error (missing/invalid fields)
- `401` — Missing or invalid JWT token
- `429` — Rate limit exceeded (>10 requests/minute)
