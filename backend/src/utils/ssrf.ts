import dns from 'dns/promises';
import net from 'net';
import { ssrfConfig, type SSRFConfig } from '../config/ssrf.config';

export interface SSRFGuardResult {
  allowed: boolean;
  hostname?: string;
  resolvedIP?: string;
  reason?: string;
}

export class SSRFError extends Error {
  public readonly code: string;
  public readonly url: string;
  public readonly reason: string;

  constructor(message: string, code: string, url: string, reason: string) {
    super(message);
    this.name = 'SSRFError';
    this.code = code;
    this.url = url;
    this.reason = reason;
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      url: this.url,
      reason: this.reason,
      message: this.message,
    };
  }
}

const PRIVATE_IPV4_RANGES = [
  { start: '10.0.0.0', end: '10.255.255.255', name: 'Class A Private' },
  { start: '172.16.0.0', end: '172.31.255.255', name: 'Class B Private' },
  { start: '192.168.0.0', end: '192.168.255.255', name: 'Class C Private' },
  { start: '127.0.0.0', end: '127.255.255.255', name: 'Loopback' },
  { start: '0.0.0.0', end: '0.255.255.255', name: 'Current Network' },
  { start: '169.254.0.0', end: '169.254.255.255', name: 'Link-Local' },
  { start: '224.0.0.0', end: '239.255.255.255', name: 'Multicast' },
  { start: '240.0.0.0', end: '255.255.255.255', name: 'Reserved' },
];

const PRIVATE_IPV6_RANGES = [
  { prefix: '::1', name: 'Loopback' },
  { prefix: 'fc00::/7', name: 'Unique Local' },
  { prefix: 'fe80::/10', name: 'Link-Local' },
  { prefix: '::ffff:0:0/96', name: 'IPv4-Mapped' },
];

function ipToNumber(ip: string): number {
  const parts = ip.split('.').map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function ipInRange(ip: string, start: string, end: string): boolean {
  const ipNum = ipToNumber(ip);
  const startNum = ipToNumber(start);
  const endNum = ipToNumber(end);
  return ipNum >= startNum && ipNum <= endNum;
}

export function isPrivateIPv4(ip: string): boolean {
  if (!net.isIPv4(ip)) {
    return false;
  }

  for (const range of PRIVATE_IPV4_RANGES) {
    if (ipInRange(ip, range.start, range.end)) {
      return true;
    }
  }

  return false;
}

export function isPrivateIPv6(ip: string): boolean {
  if (!net.isIPv6(ip)) {
    return false;
  }

  const normalized = ip.toLowerCase();

  if (normalized === '::1') {
    return true;
  }

  if (normalized === '::ffff:127.0.0.1' || normalized === '::ffff:7f00:1') {
    return true;
  }

  if (normalized.startsWith('fc') || normalized.startsWith('fd')) {
    return true;
  }

  if (normalized.startsWith('fe80:')) {
    return true;
  }

  if (normalized.startsWith('::ffff:10.') ||
      normalized.startsWith('::ffff:172.16.') ||
      normalized.startsWith('::ffff:172.17.') ||
      normalized.startsWith('::ffff:172.18.') ||
      normalized.startsWith('::ffff:172.19.') ||
      normalized.startsWith('::ffff:172.1a.') ||
      normalized.startsWith('::ffff:172.1b.') ||
      normalized.startsWith('::ffff:172.1c.') ||
      normalized.startsWith('::ffff:172.1d.') ||
      normalized.startsWith('::ffff:172.1e.') ||
      normalized.startsWith('::ffff:172.1f.') ||
      normalized.startsWith('::ffff:172.20.') ||
      normalized.startsWith('::ffff:172.21.') ||
      normalized.startsWith('::ffff:172.22.') ||
      normalized.startsWith('::ffff:172.23.') ||
      normalized.startsWith('::ffff:172.24.') ||
      normalized.startsWith('::ffff:172.25.') ||
      normalized.startsWith('::ffff:172.26.') ||
      normalized.startsWith('::ffff:172.27.') ||
      normalized.startsWith('::ffff:172.28.') ||
      normalized.startsWith('::ffff:172.29.') ||
      normalized.startsWith('::ffff:172.2a.') ||
      normalized.startsWith('::ffff:172.2b.') ||
      normalized.startsWith('::ffff:172.2c.') ||
      normalized.startsWith('::ffff:172.2d.') ||
      normalized.startsWith('::ffff:172.2e.') ||
      normalized.startsWith('::ffff:172.2f.') ||
      normalized.startsWith('::ffff:172.30.') ||
      normalized.startsWith('::ffff:172.31.') ||
      normalized.startsWith('::ffff:192.168.')) {
    return true;
  }

  return false;
}

export function isPrivateIP(ip: string): boolean {
  return isPrivateIPv4(ip) || isPrivateIPv6(ip);
}

async function resolveHostnameWithDNSOverHTTPS(hostname: string): Promise<string[]> {
  try {
    const response = await fetch(`https://1.1.1.1/dns-query?name=${encodeURIComponent(hostname)}&type=A`, {
      headers: {
        Accept: 'application/dns-json',
      },
    });

    if (response.ok) {
      const data = await response.json() as { Answer?: Array<{ data: string }> };
      if (data.Answer) {
        return data.Answer.map(a => a.data).filter(ip => net.isIP(ip) > 0);
      }
    }
  } catch {
    // DNS-over-HTTPS failed, will fall back to system DNS
  }
  return [];
}

async function resolveHostname(hostname: string): Promise<string[]> {
  try {
    const records = await dns.lookup(hostname, { all: true, verbatim: true });
    return records.map(r => r.address);
  } catch {
    return [];
  }
}

export function createSSRFGuard(config: SSRFConfig) {
  const {
    allowedDomains = ssrfConfig.allowedDomains,
    allowedPatterns = ssrfConfig.allowedPatterns,
    timeout = ssrfConfig.timeout,
    maxResponseSize = ssrfConfig.maxResponseSize,
    allowedProtocols = ssrfConfig.allowedProtocols,
  } = config;

  const domainSet = new Set(allowedDomains.map(d => d.toLowerCase()));

  return async function ssrfGuard(url: string): Promise<void> {
    let parsedUrl: URL;

    try {
      parsedUrl = new URL(url);
    } catch {
      throw new SSRFError(
        `Invalid URL: ${url}`,
        'INVALID_URL',
        url,
        'URL could not be parsed'
      );
    }

    const protocol = parsedUrl.protocol.toLowerCase();
    if (!allowedProtocols.includes(protocol)) {
      throw new SSRFError(
        `Disallowed protocol: ${protocol}`,
        'INVALID_PROTOCOL',
        url,
        `Protocol must be one of: ${allowedProtocols.join(', ')}`
      );
    }

    const hostname = parsedUrl.hostname.toLowerCase();

    if (hostname === 'localhost' || hostname.endsWith('.local') || hostname === '0.0.0.0') {
      throw new SSRFError(
        `Blocked hostname: ${hostname}`,
        'BLOCKED_HOSTNAME',
        url,
        'Localhost and .local domains are not allowed'
      );
    }

    if (net.isIP(hostname)) {
      const ip = net.isIPv4(hostname) ? hostname : hostname;
      if (isPrivateIP(ip)) {
        throw new SSRFError(
          `Private IP direct access blocked: ${hostname}`,
          'PRIVATE_IP',
          url,
          'Direct IP addresses in private ranges are not allowed'
        );
      }
      return;
    }

    if (domainSet.size > 0 && !domainSet.has(hostname)) {
      const isSubdomain = Array.from(domainSet).some(
        allowed => hostname.endsWith('.' + allowed)
      );
      if (!isSubdomain) {
        throw new SSRFError(
          `Domain not in allowlist: ${hostname}`,
          'DOMAIN_NOT_ALLOWED',
          url,
          `Domain must be one of: ${Array.from(domainSet).join(', ')}`
        );
      }
    }

    if (allowedPatterns.length > 0) {
      const urlMatchesPattern = allowedPatterns.some(pattern => pattern.test(url));
      if (!urlMatchesPattern) {
        throw new SSRFError(
          `URL does not match allowed pattern`,
          'PATTERN_MISMATCH',
          url,
          'URL does not match any allowed pattern'
        );
      }
    }

    let resolvedIPs: string[];

    try {
      const dnsResults = await Promise.race([
        resolveHostnameWithDNSOverHTTPS(hostname),
        resolveHostname(hostname),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('DNS resolution timeout')), 5000)
        ),
      ]);

      if (dnsResults.length === 0) {
        throw new SSRFError(
          `DNS resolution failed for: ${hostname}`,
          'DNS_RESOLUTION_FAILED',
          url,
          'Could not resolve hostname'
        );
      }

      resolvedIPs = dnsResults;
    } catch (error) {
      if (error instanceof SSRFError) {
        throw error;
      }
      throw new SSRFError(
        `DNS resolution failed: ${hostname}`,
        'DNS_RESOLUTION_FAILED',
        url,
        'Could not resolve hostname'
      );
    }

    for (const ip of resolvedIPs) {
      if (isPrivateIP(ip)) {
        throw new SSRFError(
          `Resolved to private IP: ${ip} (for ${hostname})`,
          'PRIVATE_IP_AFTER_DNS',
          url,
          `Hostname resolves to private IP range: ${ip}`
        );
      }
    }
  };
}

let defaultGuardInstance: ReturnType<typeof createSSRFGuard> | null = null;

export function getDefaultGuard(): ReturnType<typeof createSSRFGuard> {
  if (!defaultGuardInstance) {
    defaultGuardInstance = createSSRFGuard({});
  }
  return defaultGuardInstance;
}

export const ssrfGuard = getDefaultGuard();

export { createSSRFGuard as createGuard };
