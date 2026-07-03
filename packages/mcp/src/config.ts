/** Environment-based configuration with validation. */

export interface Config {
  apiKey: string;
  userId: string;
  baseUrl: string;
  timeoutMs: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  tlsSkipVerify: boolean;
  maxRetries: number;
  defaultLayer?: string;
  defaultProjectId?: string;
}

export function loadConfig(): Config {
  const apiKey = process.env.ENGRAM_API_KEY || '';
  const userId = process.env.ENGRAM_USER_ID || 'Beaux';

  const baseUrl = (process.env.ENGRAM_API_URL || process.env.ENGRAM_BASE_URL || 'https://api.openengram.ai').replace(/\/$/, '');

  // Enforce HTTPS for non-localhost
  const url = new URL(baseUrl);
  const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
  const tlsSkipVerify = process.env.ENGRAM_TLS_SKIP_VERIFY === 'true';
  if (!isLocalhost && url.protocol !== 'https:' && !process.env.ENGRAM_ALLOW_HTTP) {
    console.error(`HTTPS required for non-localhost URLs. Got: ${baseUrl}. Set ENGRAM_ALLOW_HTTP=true to override.`);
    process.exit(1);
  }

  const logLevel = (process.env.ENGRAM_LOG_LEVEL || 'warn') as Config['logLevel'];
  if (!['debug', 'info', 'warn', 'error'].includes(logLevel)) {
    console.error(`Invalid ENGRAM_LOG_LEVEL: ${logLevel}`);
    process.exit(1);
  }

  return {
    apiKey,
    userId,
    baseUrl,
    timeoutMs: parseInt(process.env.ENGRAM_TIMEOUT_MS || '10000', 10),
    logLevel,
    tlsSkipVerify,
    maxRetries: parseInt(process.env.ENGRAM_MAX_RETRIES || '2', 10),
    defaultLayer: process.env.ENGRAM_DEFAULT_LAYER,
    defaultProjectId: process.env.ENGRAM_PROJECT_ID,
  };
}
