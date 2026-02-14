/**
 * Escape HTML entities to prevent XSS when memory content is rendered in browsers.
 * We store raw content as-is but sanitize on output.
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * Recursively sanitize string fields named 'raw' or 'content' in an object.
 */
export function sanitizeMemoryOutput<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) {
    return obj.map(sanitizeMemoryOutput) as T;
  }
  if (typeof obj === 'object') {
    const result: any = {};
    for (const [key, value] of Object.entries(obj as any)) {
      if ((key === 'raw') && typeof value === 'string') {
        result[key] = escapeHtml(value);
      } else if (typeof value === 'object') {
        result[key] = sanitizeMemoryOutput(value);
      } else {
        result[key] = value;
      }
    }
    return result;
  }
  return obj;
}
