/** Simple stderr logger (stdout reserved for MCP stdio transport). */

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;

let currentLevel: number = LEVELS.warn;

export function setLogLevel(level: keyof typeof LEVELS): void {
  currentLevel = LEVELS[level];
}

function log(level: keyof typeof LEVELS, msg: string, data?: Record<string, unknown>): void {
  if (LEVELS[level] < currentLevel) return;
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...(data ? { data } : {}),
  };
  // Redact sensitive fields
  const str = JSON.stringify(entry, (_key, value) => {
    if (typeof _key === 'string' && /apikey|api_key|secret|password|token/i.test(_key)) {
      return '[REDACTED]';
    }
    return value;
  });
  process.stderr.write(str + '\n');
}

export const logger = {
  debug: (msg: string, data?: Record<string, unknown>) => log('debug', msg, data),
  info: (msg: string, data?: Record<string, unknown>) => log('info', msg, data),
  warn: (msg: string, data?: Record<string, unknown>) => log('warn', msg, data),
  error: (msg: string, data?: Record<string, unknown>) => log('error', msg, data),
};
