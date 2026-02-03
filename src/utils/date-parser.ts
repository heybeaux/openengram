/**
 * Robust date parsing utility for LLM-extracted temporal references
 * Handles ISO dates, relative dates, and natural language formats
 */

/**
 * Parse a date string from LLM extraction into a Date object
 * Returns null for invalid or unparseable dates
 * 
 * @param dateStr - The date string to parse (ISO, relative, or natural language)
 * @param referenceDate - Reference date for relative calculations (defaults to now)
 */
export function parseFlexibleDate(
  dateStr: string | null | undefined,
  referenceDate: Date = new Date(),
): Date | null {
  if (!dateStr || typeof dateStr !== 'string') {
    return null;
  }

  const normalized = dateStr.trim().toLowerCase();
  
  if (!normalized) {
    return null;
  }

  // Try parsers in order of specificity
  const parsers = [
    parseISODate,
    parseRelativeDate,
    parseNaturalLanguageDate,
    parseMonthDayYear,
  ];

  for (const parser of parsers) {
    const result = parser(normalized, referenceDate);
    if (result && isValidDate(result)) {
      return result;
    }
  }

  // Final fallback: try native Date constructor
  const nativeAttempt = new Date(dateStr);
  if (isValidDate(nativeAttempt)) {
    return nativeAttempt;
  }

  return null;
}

/**
 * Check if a Date object is valid (not Invalid Date)
 */
function isValidDate(date: Date): boolean {
  return date instanceof Date && !isNaN(date.getTime());
}

/**
 * Parse ISO format dates: "2026-02-01", "2026-02-01T10:30:00Z"
 */
function parseISODate(dateStr: string): Date | null {
  // Match YYYY-MM-DD with optional time component
  const isoMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const date = new Date(dateStr);
    if (isValidDate(date)) {
      return date;
    }
  }
  return null;
}

/**
 * Parse relative date expressions
 */
function parseRelativeDate(dateStr: string, ref: Date): Date | null {
  const today = new Date(ref);
  today.setHours(0, 0, 0, 0);

  // Exact matches
  if (dateStr === 'today' || dateStr === 'now') {
    return today;
  }
  
  if (dateStr === 'yesterday') {
    const d = new Date(today);
    d.setDate(d.getDate() - 1);
    return d;
  }
  
  if (dateStr === 'tomorrow') {
    const d = new Date(today);
    d.setDate(d.getDate() + 1);
    return d;
  }

  // "X days/weeks/months ago"
  const agoMatch = dateStr.match(/^(\d+)\s+(day|week|month|year)s?\s+ago$/);
  if (agoMatch) {
    const amount = parseInt(agoMatch[1], 10);
    const unit = agoMatch[2];
    return subtractFromDate(today, amount, unit);
  }

  // "a day/week/month ago"
  const aAgoMatch = dateStr.match(/^(?:a|an|one)\s+(day|week|month|year)\s+ago$/);
  if (aAgoMatch) {
    const unit = aAgoMatch[1];
    return subtractFromDate(today, 1, unit);
  }

  // "last week/month/year"
  const lastMatch = dateStr.match(/^last\s+(week|month|year)$/);
  if (lastMatch) {
    const unit = lastMatch[1];
    return subtractFromDate(today, 1, unit);
  }

  // "this week/month/year" - start of the period
  const thisMatch = dateStr.match(/^this\s+(week|month|year)$/);
  if (thisMatch) {
    const unit = thisMatch[1];
    return getStartOfPeriod(today, unit);
  }

  // "last Monday/Tuesday/etc."
  const lastDayMatch = dateStr.match(/^last\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/);
  if (lastDayMatch) {
    const targetDay = getDayNumber(lastDayMatch[1]);
    if (targetDay !== null) {
      return getLastWeekday(today, targetDay);
    }
  }

  // "on Monday/Tuesday/etc." (interpret as most recent)
  const onDayMatch = dateStr.match(/^(?:on\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/);
  if (onDayMatch) {
    const targetDay = getDayNumber(onDayMatch[1]);
    if (targetDay !== null) {
      return getMostRecentWeekday(today, targetDay);
    }
  }

  return null;
}

/**
 * Parse natural language dates like "February 1st, 2026" or "Feb 1, 2026"
 */
function parseNaturalLanguageDate(dateStr: string): Date | null {
  // Month names mapping
  const months: Record<string, number> = {
    january: 0, jan: 0,
    february: 1, feb: 1,
    march: 2, mar: 2,
    april: 3, apr: 3,
    may: 4,
    june: 5, jun: 5,
    july: 6, jul: 6,
    august: 7, aug: 7,
    september: 8, sep: 8, sept: 8,
    october: 9, oct: 9,
    november: 10, nov: 10,
    december: 11, dec: 11,
  };

  // "February 1st, 2026" or "February 1, 2026" or "Feb 1st 2026"
  const fullMatch = dateStr.match(
    /^(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|sept|october|oct|november|nov|december|dec)\s+(\d{1,2})(?:st|nd|rd|th)?[,\s]+(\d{4})$/
  );
  if (fullMatch) {
    const month = months[fullMatch[1]];
    const day = parseInt(fullMatch[2], 10);
    const year = parseInt(fullMatch[3], 10);
    if (month !== undefined && day >= 1 && day <= 31 && year >= 1900 && year <= 2100) {
      return new Date(year, month, day);
    }
  }

  // "1 February 2026" or "1st February, 2026"
  const dayFirstMatch = dateStr.match(
    /^(\d{1,2})(?:st|nd|rd|th)?\s+(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|sept|october|oct|november|nov|december|dec)[,\s]+(\d{4})$/
  );
  if (dayFirstMatch) {
    const day = parseInt(dayFirstMatch[1], 10);
    const month = months[dayFirstMatch[2]];
    const year = parseInt(dayFirstMatch[3], 10);
    if (month !== undefined && day >= 1 && day <= 31 && year >= 1900 && year <= 2100) {
      return new Date(year, month, day);
    }
  }

  // "February 2026" (first of month)
  const monthYearMatch = dateStr.match(
    /^(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|sept|october|oct|november|nov|december|dec)\s+(\d{4})$/
  );
  if (monthYearMatch) {
    const month = months[monthYearMatch[1]];
    const year = parseInt(monthYearMatch[2], 10);
    if (month !== undefined && year >= 1900 && year <= 2100) {
      return new Date(year, month, 1);
    }
  }

  return null;
}

/**
 * Parse MM/DD/YYYY or DD/MM/YYYY formats
 * Assumes MM/DD/YYYY (US format) but validates reasonably
 */
function parseMonthDayYear(dateStr: string): Date | null {
  // MM/DD/YYYY or M/D/YYYY
  const slashMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const first = parseInt(slashMatch[1], 10);
    const second = parseInt(slashMatch[2], 10);
    const year = parseInt(slashMatch[3], 10);
    
    // Assume MM/DD/YYYY format
    if (first >= 1 && first <= 12 && second >= 1 && second <= 31) {
      return new Date(year, first - 1, second);
    }
  }

  // MM-DD-YYYY (non-ISO)
  const dashMatch = dateStr.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (dashMatch) {
    const first = parseInt(dashMatch[1], 10);
    const second = parseInt(dashMatch[2], 10);
    const year = parseInt(dashMatch[3], 10);
    
    if (first >= 1 && first <= 12 && second >= 1 && second <= 31) {
      return new Date(year, first - 1, second);
    }
  }

  return null;
}

/**
 * Subtract time from a date
 */
function subtractFromDate(date: Date, amount: number, unit: string): Date {
  const result = new Date(date);
  
  switch (unit) {
    case 'day':
      result.setDate(result.getDate() - amount);
      break;
    case 'week':
      result.setDate(result.getDate() - amount * 7);
      break;
    case 'month':
      result.setMonth(result.getMonth() - amount);
      break;
    case 'year':
      result.setFullYear(result.getFullYear() - amount);
      break;
  }
  
  return result;
}

/**
 * Get the start of a time period
 */
function getStartOfPeriod(date: Date, unit: string): Date {
  const result = new Date(date);
  
  switch (unit) {
    case 'week':
      // Start of week (Sunday)
      const day = result.getDay();
      result.setDate(result.getDate() - day);
      break;
    case 'month':
      result.setDate(1);
      break;
    case 'year':
      result.setMonth(0, 1);
      break;
  }
  
  return result;
}

/**
 * Get day of week number (0=Sunday, 1=Monday, etc.)
 */
function getDayNumber(dayName: string): number | null {
  const days: Record<string, number> = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };
  return days[dayName] ?? null;
}

/**
 * Get the most recent occurrence of a weekday (including today if it matches)
 */
function getMostRecentWeekday(date: Date, targetDay: number): Date {
  const result = new Date(date);
  const currentDay = result.getDay();
  const diff = (currentDay - targetDay + 7) % 7;
  result.setDate(result.getDate() - diff);
  return result;
}

/**
 * Get last week's occurrence of a weekday
 */
function getLastWeekday(date: Date, targetDay: number): Date {
  const result = getMostRecentWeekday(date, targetDay);
  // If we got today, go back a week
  if (result.getTime() === date.getTime()) {
    result.setDate(result.getDate() - 7);
  }
  return result;
}
