import { parseFlexibleDate } from './date-parser';

describe('parseFlexibleDate', () => {
  // Use a fixed reference date for consistent testing
  const referenceDate = new Date('2026-02-02T12:00:00Z');

  describe('null/undefined/empty handling', () => {
    it('returns null for null input', () => {
      expect(parseFlexibleDate(null)).toBeNull();
    });

    it('returns null for undefined input', () => {
      expect(parseFlexibleDate(undefined)).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(parseFlexibleDate('')).toBeNull();
    });

    it('returns null for whitespace-only string', () => {
      expect(parseFlexibleDate('   ')).toBeNull();
    });
  });

  describe('ISO date formats', () => {
    it('parses YYYY-MM-DD', () => {
      const result = parseFlexibleDate('2026-02-01');
      expect(result).toBeInstanceOf(Date);
      expect(result?.toISOString().startsWith('2026-02-01')).toBe(true);
    });

    it('parses YYYY-MM-DDTHH:MM:SS', () => {
      const result = parseFlexibleDate('2026-02-01T10:30:00');
      expect(result).toBeInstanceOf(Date);
    });

    it('parses YYYY-MM-DDTHH:MM:SSZ', () => {
      const result = parseFlexibleDate('2026-02-01T10:30:00Z');
      expect(result).toBeInstanceOf(Date);
    });
  });

  describe('relative dates', () => {
    it('parses "today"', () => {
      const result = parseFlexibleDate('today', referenceDate);
      expect(result?.toISOString().startsWith('2026-02-02')).toBe(true);
    });

    it('parses "yesterday"', () => {
      const result = parseFlexibleDate('yesterday', referenceDate);
      expect(result?.toISOString().startsWith('2026-02-01')).toBe(true);
    });

    it('parses "tomorrow"', () => {
      const result = parseFlexibleDate('tomorrow', referenceDate);
      expect(result?.toISOString().startsWith('2026-02-03')).toBe(true);
    });

    it('parses "2 days ago"', () => {
      const result = parseFlexibleDate('2 days ago', referenceDate);
      expect(result?.toISOString().startsWith('2026-01-31')).toBe(true);
    });

    it('parses "3 weeks ago"', () => {
      const result = parseFlexibleDate('3 weeks ago', referenceDate);
      expect(result).toBeInstanceOf(Date);
      // 3 weeks = 21 days before Feb 2 = Jan 12
      expect(result?.getDate()).toBe(12);
      expect(result?.getMonth()).toBe(0); // January
    });

    it('parses "a week ago"', () => {
      const result = parseFlexibleDate('a week ago', referenceDate);
      expect(result?.toISOString().startsWith('2026-01-26')).toBe(true);
    });

    it('parses "one month ago"', () => {
      const result = parseFlexibleDate('one month ago', referenceDate);
      expect(result?.getMonth()).toBe(0); // January
    });

    it('parses "last week"', () => {
      const result = parseFlexibleDate('last week', referenceDate);
      expect(result).toBeInstanceOf(Date);
    });

    it('parses "last month"', () => {
      const result = parseFlexibleDate('last month', referenceDate);
      expect(result?.getMonth()).toBe(0); // January
    });

    it('parses "last year"', () => {
      const result = parseFlexibleDate('last year', referenceDate);
      expect(result?.getFullYear()).toBe(2025);
    });
  });

  describe('natural language dates', () => {
    it('parses "February 1st, 2026"', () => {
      const result = parseFlexibleDate('February 1st, 2026');
      expect(result?.getFullYear()).toBe(2026);
      expect(result?.getMonth()).toBe(1); // February
      expect(result?.getDate()).toBe(1);
    });

    it('parses "Feb 1, 2026"', () => {
      const result = parseFlexibleDate('Feb 1, 2026');
      expect(result?.getFullYear()).toBe(2026);
      expect(result?.getMonth()).toBe(1);
      expect(result?.getDate()).toBe(1);
    });

    it('parses "1 February 2026"', () => {
      const result = parseFlexibleDate('1 February 2026');
      expect(result?.getFullYear()).toBe(2026);
      expect(result?.getMonth()).toBe(1);
      expect(result?.getDate()).toBe(1);
    });

    it('parses "1st February, 2026"', () => {
      const result = parseFlexibleDate('1st February, 2026');
      expect(result?.getFullYear()).toBe(2026);
      expect(result?.getMonth()).toBe(1);
      expect(result?.getDate()).toBe(1);
    });

    it('parses "March 2026" as first of month', () => {
      const result = parseFlexibleDate('March 2026');
      expect(result?.getFullYear()).toBe(2026);
      expect(result?.getMonth()).toBe(2); // March
      expect(result?.getDate()).toBe(1);
    });

    it('parses various month abbreviations', () => {
      expect(parseFlexibleDate('Jan 15, 2026')?.getMonth()).toBe(0);
      expect(parseFlexibleDate('Apr 15, 2026')?.getMonth()).toBe(3);
      expect(parseFlexibleDate('Sep 15, 2026')?.getMonth()).toBe(8);
      expect(parseFlexibleDate('Dec 15, 2026')?.getMonth()).toBe(11);
    });
  });

  describe('weekday references', () => {
    // Feb 2, 2026 is a Monday
    it('parses "Monday" as most recent Monday', () => {
      const result = parseFlexibleDate('Monday', referenceDate);
      expect(result?.getDay()).toBe(1); // Monday
    });

    it('parses "last Monday"', () => {
      const result = parseFlexibleDate('last Monday', referenceDate);
      expect(result?.getDay()).toBe(1);
    });

    it('parses "on Tuesday"', () => {
      const result = parseFlexibleDate('on Tuesday', referenceDate);
      expect(result?.getDay()).toBe(2);
    });
  });

  describe('edge cases and invalid inputs', () => {
    it('returns null for gibberish', () => {
      expect(parseFlexibleDate('asdfqwerty')).toBeNull();
    });

    it('returns null for partial dates', () => {
      expect(parseFlexibleDate('February')).toBeNull();
    });

    it('handles case insensitivity', () => {
      expect(parseFlexibleDate('YESTERDAY', referenceDate)).not.toBeNull();
      expect(parseFlexibleDate('Yesterday', referenceDate)).not.toBeNull();
      expect(parseFlexibleDate('FEBRUARY 1ST, 2026')).not.toBeNull();
    });

    it('handles extra whitespace', () => {
      expect(parseFlexibleDate('  yesterday  ', referenceDate)).not.toBeNull();
    });
  });

  describe('MM/DD/YYYY formats', () => {
    it('parses 02/01/2026', () => {
      const result = parseFlexibleDate('02/01/2026');
      expect(result?.getFullYear()).toBe(2026);
      expect(result?.getMonth()).toBe(1); // February (US format)
      expect(result?.getDate()).toBe(1);
    });

    it('parses 2/1/2026', () => {
      const result = parseFlexibleDate('2/1/2026');
      expect(result?.getFullYear()).toBe(2026);
      expect(result?.getMonth()).toBe(1);
      expect(result?.getDate()).toBe(1);
    });
  });
});
