/** Input sanitization and validation utilities. */

const MAX_CONTENT_LENGTH = 50_000;
const MAX_QUERY_LENGTH = 2_000;
const MAX_TAG_LENGTH = 100;
const MAX_TAGS = 20;
const ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;
const VALID_LAYERS = ['SESSION', 'SEMANTIC', 'CORE', 'META'] as const;
const VALID_IMPORTANCE = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

/** Strip control characters (keep newlines, tabs). */
function sanitizeString(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
}

export function validateContent(content: unknown): string {
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new Error('content must be a non-empty string');
  }
  const cleaned = sanitizeString(content);
  if (cleaned.length > MAX_CONTENT_LENGTH) {
    throw new Error(`content exceeds maximum length of ${MAX_CONTENT_LENGTH} characters`);
  }
  return cleaned;
}

export function validateQuery(query: unknown): string {
  if (typeof query !== 'string' || query.trim().length === 0) {
    throw new Error('query must be a non-empty string');
  }
  const cleaned = sanitizeString(query);
  if (cleaned.length > MAX_QUERY_LENGTH) {
    throw new Error(`query exceeds maximum length of ${MAX_QUERY_LENGTH} characters`);
  }
  return cleaned;
}

export function validateId(id: unknown): string {
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    throw new Error('Invalid ID format. Must be 1-128 alphanumeric characters, hyphens, or underscores.');
  }
  return id;
}

export function validateLayer(layer: unknown): string | undefined {
  if (layer === undefined || layer === null) return undefined;
  if (typeof layer !== 'string') throw new Error('layer must be a string');
  const upper = layer.toUpperCase();
  if (!(VALID_LAYERS as readonly string[]).includes(upper)) {
    throw new Error(`Invalid layer. Must be one of: ${VALID_LAYERS.join(', ')}`);
  }
  return upper;
}

export function validateLayers(layers: unknown): string[] | undefined {
  if (layers === undefined || layers === null) return undefined;
  if (!Array.isArray(layers)) throw new Error('layers must be an array');
  return layers.map(l => {
    const v = validateLayer(l);
    if (!v) throw new Error('Invalid layer in array');
    return v;
  });
}

export function validateImportance(importance: unknown): string | undefined {
  if (importance === undefined || importance === null) return undefined;
  if (typeof importance !== 'string') throw new Error('importance must be a string');
  const upper = importance.toUpperCase();
  if (!(VALID_IMPORTANCE as readonly string[]).includes(upper)) {
    throw new Error(`Invalid importance. Must be one of: ${VALID_IMPORTANCE.join(', ')}`);
  }
  return upper;
}

export function validateTags(tags: unknown): string[] | undefined {
  if (tags === undefined || tags === null) return undefined;
  if (!Array.isArray(tags)) throw new Error('tags must be an array');
  if (tags.length > MAX_TAGS) throw new Error(`Maximum ${MAX_TAGS} tags allowed`);
  return tags.map(t => {
    if (typeof t !== 'string') throw new Error('Each tag must be a string');
    const cleaned = sanitizeString(t);
    if (cleaned.length > MAX_TAG_LENGTH) throw new Error(`Tag exceeds ${MAX_TAG_LENGTH} characters`);
    if (cleaned.length === 0) throw new Error('Empty tags not allowed');
    return cleaned;
  });
}

export function validateLimit(limit: unknown, max = 50, defaultVal = 10): number {
  if (limit === undefined || limit === null) return defaultVal;
  const n = typeof limit === 'number' ? limit : parseInt(String(limit), 10);
  if (isNaN(n) || n < 1) return defaultVal;
  return Math.min(n, max);
}

export function validateMaxTokens(maxTokens: unknown, defaultVal = 4000): number {
  if (maxTokens === undefined || maxTokens === null) return defaultVal;
  const n = typeof maxTokens === 'number' ? maxTokens : parseInt(String(maxTokens), 10);
  if (isNaN(n) || n < 100) return defaultVal;
  return Math.min(n, 32000);
}
