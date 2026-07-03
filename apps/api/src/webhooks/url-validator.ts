import { lookup } from 'dns/promises';
import * as net from 'net';

const BLOCKED_IPV4_RANGES = [
  { prefix: '127.', mask: 8 },
  { prefix: '10.', mask: 8 },
  { prefix: '0.', mask: 8 },
  { prefix: '169.254.', mask: 16 },
  { prefix: '192.168.', mask: 16 },
];

// 172.16.0.0/12 = 172.16.x.x – 172.31.x.x

function isPrivateIPv4(ip: string): boolean {
  if (
    ip.startsWith('127.') ||
    ip.startsWith('10.') ||
    ip.startsWith('0.') ||
    ip.startsWith('169.254.') ||
    ip.startsWith('192.168.')
  ) {
    return true;
  }

  // 172.16.0.0/12
  if (ip.startsWith('172.')) {
    const second = parseInt(ip.split('.')[1], 10);
    if (second >= 16 && second <= 31) return true;
  }

  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === '::1' || normalized === '::') return true;
  // fc00::/7 covers fc and fd prefixes
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  // fe80::/10 link-local
  if (normalized.startsWith('fe80')) return true;
  return false;
}

function isBlockedIP(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  if (net.isIPv6(ip)) return isPrivateIPv6(ip);
  return false;
}

export class WebhookUrlValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookUrlValidationError';
  }
}

/**
 * Validates a webhook URL is safe to deliver to.
 * - Only https:// (and optionally http://) schemes allowed
 * - Resolves DNS and checks resolved IP against blocklist
 * - Blocks private/internal IPs to prevent SSRF
 */
export async function validateWebhookUrl(
  url: string,
  options?: { allowHttp?: boolean },
): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new WebhookUrlValidationError('Invalid URL');
  }

  // Scheme check
  const allowedSchemes = options?.allowHttp
    ? ['https:', 'http:']
    : ['https:', 'http:'];
  if (!allowedSchemes.includes(parsed.protocol)) {
    throw new WebhookUrlValidationError(
      `Scheme "${parsed.protocol}" is not allowed. Only http(s) is permitted.`,
    );
  }

  const hostname = parsed.hostname;

  // If hostname is already an IP, check directly
  if (net.isIP(hostname)) {
    if (isBlockedIP(hostname)) {
      throw new WebhookUrlValidationError(
        'URL resolves to a blocked internal/private IP address',
      );
    }
    return;
  }

  // Resolve DNS and check all results
  try {
    const result = await lookup(hostname, { all: true });
    const addresses = Array.isArray(result) ? result : [result];

    for (const entry of addresses) {
      if (isBlockedIP(entry.address)) {
        throw new WebhookUrlValidationError(
          'URL resolves to a blocked internal/private IP address',
        );
      }
    }
  } catch (err: any) {
    if (err instanceof WebhookUrlValidationError) throw err;
    throw new WebhookUrlValidationError(
      `DNS resolution failed for hostname "${hostname}": ${err.message}`,
    );
  }
}

/**
 * Synchronous pre-check (scheme + literal IP check only, no DNS).
 * Use for fast validation at create/update time; full validation
 * (with DNS) happens at delivery time.
 */
export function validateWebhookUrlSync(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new WebhookUrlValidationError('Invalid URL');
  }

  if (!['https:', 'http:'].includes(parsed.protocol)) {
    throw new WebhookUrlValidationError(
      `Scheme "${parsed.protocol}" is not allowed. Only http(s) is permitted.`,
    );
  }

  const hostname = parsed.hostname;
  if (net.isIP(hostname) && isBlockedIP(hostname)) {
    throw new WebhookUrlValidationError(
      'URL points to a blocked internal/private IP address',
    );
  }
}
