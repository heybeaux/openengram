import { escapeHtml, sanitizeMemoryOutput } from './html-sanitize';

describe('html-sanitize utilities', () => {
  describe('escapeHtml', () => {
    it('escapes the full set of HTML-sensitive characters', () => {
      expect(escapeHtml(`<script data-x="1">Tom & 'Jerry'</script>`)).toBe(
        '&lt;script data-x=&quot;1&quot;&gt;Tom &amp; &#x27;Jerry&#x27;&lt;/script&gt;',
      );
    });

    it('does not double-touch strings without escapable characters', () => {
      expect(escapeHtml('plain memory content')).toBe('plain memory content');
    });
  });

  describe('sanitizeMemoryOutput', () => {
    it('escapes raw fields recursively while leaving other string fields unchanged', () => {
      const input = {
        id: 'mem_1',
        content: '<b>keep content raw</b>',
        raw: '<img src=x onerror="alert(1)">',
        nested: {
          raw: "Alice & Bob's note",
          label: '<safe label>',
        },
        list: [
          { raw: '<script>alert(1)</script>' },
          { content: '<p>not escaped by this helper</p>' },
        ],
      };

      expect(sanitizeMemoryOutput(input)).toEqual({
        id: 'mem_1',
        content: '<b>keep content raw</b>',
        raw: '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;',
        nested: {
          raw: 'Alice &amp; Bob&#x27;s note',
          label: '<safe label>',
        },
        list: [
          { raw: '&lt;script&gt;alert(1)&lt;/script&gt;' },
          { content: '<p>not escaped by this helper</p>' },
        ],
      });
    });

    it('preserves nullish values, primitives, and Date instances', () => {
      const when = new Date('2026-07-04T10:00:00Z');

      expect(sanitizeMemoryOutput(null)).toBeNull();
      expect(sanitizeMemoryOutput(undefined)).toBeUndefined();
      expect(sanitizeMemoryOutput('raw <not object>')).toBe('raw <not object>');
      expect(sanitizeMemoryOutput(when)).toBe(when);
      expect(sanitizeMemoryOutput({ createdAt: when })).toEqual({ createdAt: when });
    });
  });
});
