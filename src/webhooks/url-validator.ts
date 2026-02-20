import { lookup } from 'dns/promises';
import * as net from 'net';

export class WebhookUrlValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookUrlValidationError';
  }
}

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
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (normalized.startsWith('fe80')) return true;
  return false;
}

function isBlockedIP(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  if (net.isIPv6(ip)) return isPrivateIPv6(ip);
  return false;
}

/**
 * Async validation: scheme check + DNS resolution + IP blocklist.
 * Use at delivery time to prevent DNS rebinding attacks.
 */
export async function validateWebhookUrl(url: string): Promise<void> {
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

  if (net.isIP(hostname)) {
    if (isBlockedIP(hostname)) {
      throw new WebhookUrlValidationError(
        'URL resolves to a blocked internal/private IP address',
      );
    }
    return;
  }

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
 * Synchronous pre-check (scheme + literal IP only, no DNS).
 * Use at create/update time for fast feedback.
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
