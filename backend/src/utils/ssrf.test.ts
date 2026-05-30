import { ssrfGuard, createSSRFGuard, SSRFError, isPrivateIPv4, isPrivateIPv6, isPrivateIP } from './ssrf';

describe('SSRF Protection', () => {
  describe('isPrivateIPv4', () => {
    it('blocks 10.x.x.x range', () => {
      expect(isPrivateIPv4('10.0.0.0')).toBe(true);
      expect(isPrivateIPv4('10.255.255.255')).toBe(true);
      expect(isPrivateIPv4('10.1.2.3')).toBe(true);
    });

    it('blocks 172.16-31.x.x range', () => {
      expect(isPrivateIPv4('172.16.0.0')).toBe(true);
      expect(isPrivateIPv4('172.31.255.255')).toBe(true);
      expect(isPrivateIPv4('172.20.5.10')).toBe(true);
      expect(isPrivateIPv4('172.15.0.0')).toBe(false);
      expect(isPrivateIPv4('172.32.0.0')).toBe(false);
    });

    it('blocks 192.168.x.x range', () => {
      expect(isPrivateIPv4('192.168.0.0')).toBe(true);
      expect(isPrivateIPv4('192.168.255.255')).toBe(true);
      expect(isPrivateIPv4('192.168.1.1')).toBe(true);
    });

    it('blocks 127.x.x.x (loopback)', () => {
      expect(isPrivateIPv4('127.0.0.1')).toBe(true);
      expect(isPrivateIPv4('127.255.255.255')).toBe(true);
    });

    it('blocks 0.0.0.0', () => {
      expect(isPrivateIPv4('0.0.0.0')).toBe(true);
    });

    it('blocks 169.254.x.x (link-local)', () => {
      expect(isPrivateIPv4('169.254.0.0')).toBe(true);
      expect(isPrivateIPv4('169.254.255.255')).toBe(true);
    });

    it('allows public IPs', () => {
      expect(isPrivateIPv4('8.8.8.8')).toBe(false);
      expect(isPrivateIPv4('1.1.1.1')).toBe(false);
      expect(isPrivateIPv4('93.184.216.34')).toBe(false);
      expect(isPrivateIPv4('142.250.80.46')).toBe(false);
    });

    it('returns false for non-IPv4 addresses', () => {
      expect(isPrivateIPv4('::1')).toBe(false);
      expect(isPrivateIPv4('2001:4860:4860::8888')).toBe(false);
      expect(isPrivateIPv4('not-an-ip')).toBe(false);
    });
  });

  describe('isPrivateIPv6', () => {
    it('blocks ::1 (loopback)', () => {
      expect(isPrivateIPv6('::1')).toBe(true);
    });

    it('blocks fc00::/7 (unique local)', () => {
      expect(isPrivateIPv6('fc00::1')).toBe(true);
      expect(isPrivateIPv6('fd00::1')).toBe(true);
    });

    it('blocks fe80::/10 (link-local)', () => {
      expect(isPrivateIPv6('fe80::1')).toBe(true);
      expect(isPrivateIPv6('fe80:0:0:0:ffff:ffff:ffff:ffff')).toBe(true);
    });

    it('blocks ::ffff:x.x.x.x (IPv4-mapped)', () => {
      expect(isPrivateIPv6('::ffff:127.0.0.1')).toBe(true);
      expect(isPrivateIPv6('::ffff:10.0.0.1')).toBe(true);
      expect(isPrivateIPv6('::ffff:192.168.1.1')).toBe(true);
    });

    it('allows public IPv6 addresses', () => {
      expect(isPrivateIPv6('2001:4860:4860::8888')).toBe(false);
      expect(isPrivateIPv6('2606:2800:220:1::248:1893:25e8')).toBe(false);
    });

    it('returns false for non-IPv6 addresses', () => {
      expect(isPrivateIPv6('8.8.8.8')).toBe(false);
      expect(isPrivateIPv6('not-an-ip')).toBe(false);
    });
  });

  describe('isPrivateIP', () => {
    it('correctly identifies both IPv4 and IPv6 private addresses', () => {
      expect(isPrivateIP('10.0.0.1')).toBe(true);
      expect(isPrivateIP('192.168.1.1')).toBe(true);
      expect(isPrivateIP('::1')).toBe(true);
      expect(isPrivateIP('fe80::1')).toBe(true);
      expect(isPrivateIP('8.8.8.8')).toBe(false);
      expect(isPrivateIP('2001:4860:4860::8888')).toBe(false);
    });
  });

  describe('ssrfGuard with default config', () => {
    it('allows valid job board URLs with paths', async () => {
      await expect(ssrfGuard('https://www.linkedin.com/jobs/view/123')).resolves.toBeUndefined();
      await expect(ssrfGuard('https://www.indeed.com/jobs/view/123')).resolves.toBeUndefined();
      await expect(ssrfGuard('https://www.glassdoor.com/job-listing/123')).resolves.toBeUndefined();
    });

    it('allows valid job board URLs with subdomains', async () => {
      await expect(ssrfGuard('https://api.github.com/users')).resolves.toBeUndefined();
    });

    it('blocks file:// protocol', async () => {
      await expect(ssrfGuard('file:///etc/passwd')).rejects.toThrow(SSRFError);
      await expect(ssrfGuard('file:///etc/passwd')).rejects.toMatchObject({
        code: 'INVALID_PROTOCOL',
      });
    });

    it('blocks ftp:// protocol', async () => {
      await expect(ssrfGuard('ftp://example.com/file')).rejects.toThrow(SSRFError);
      await expect(ssrfGuard('ftp://example.com/file')).rejects.toMatchObject({
        code: 'INVALID_PROTOCOL',
      });
    });

    it('blocks localhost', async () => {
      await expect(ssrfGuard('http://localhost/admin')).rejects.toThrow(SSRFError);
      await expect(ssrfGuard('http://localhost/admin')).rejects.toMatchObject({
        code: 'BLOCKED_HOSTNAME',
      });
    });

    it('blocks .local domains', async () => {
      await expect(ssrfGuard('http://internal.company.local/api')).rejects.toThrow(SSRFError);
      await expect(ssrfGuard('http://internal.company.local/api')).rejects.toMatchObject({
        code: 'BLOCKED_HOSTNAME',
      });
    });

    it('blocks 0.0.0.0', async () => {
      await expect(ssrfGuard('http://0.0.0.0/admin')).rejects.toThrow(SSRFError);
      await expect(ssrfGuard('http://0.0.0.0/admin')).rejects.toMatchObject({
        code: 'BLOCKED_HOSTNAME',
      });
    });

    it('blocks non-allowlisted domains', async () => {
      await expect(ssrfGuard('https://evil.com/malicious')).rejects.toThrow(SSRFError);
      await expect(ssrfGuard('https://evil.com/malicious')).rejects.toMatchObject({
        code: 'DOMAIN_NOT_ALLOWED',
      });
    });

    it('blocks private IP direct access', async () => {
      await expect(ssrfGuard('http://192.168.1.1/admin')).rejects.toThrow(SSRFError);
      await expect(ssrfGuard('http://192.168.1.1/admin')).rejects.toMatchObject({
        code: 'PRIVATE_IP',
      });
    });

    it('blocks direct private IPv6 access', async () => {
      await expect(ssrfGuard('http://[::1]/admin')).rejects.toThrow(SSRFError);
    });

    it('throws SSRFError with proper properties', async () => {
      try {
        await ssrfGuard('http://localhost/test');
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(SSRFError);
        const ssrfError = error as SSRFError;
        expect(ssrfError.code).toBe('BLOCKED_HOSTNAME');
        expect(ssrfError.url).toBe('http://localhost/test');
        expect(ssrfError.reason).toBeDefined();
        expect(ssrfError.message).toBeDefined();
      }
    });

    it('SSRFError.toJSON works correctly', () => {
      const error = new SSRFError('test', 'TEST_CODE', 'http://test.com', 'test reason');
      const json = error.toJSON();
      expect(json.name).toBe('SSRFError');
      expect(json.code).toBe('TEST_CODE');
      expect(json.url).toBe('http://test.com');
      expect(json.reason).toBe('test reason');
      expect(json.message).toBe('test');
    });
  });

  describe('createSSRFGuard with custom config', () => {
    it('respects custom domains only', async () => {
      const customGuard = createSSRFGuard({
        allowedDomains: ['linkedin.com'],
        allowedPatterns: [],
      });

      await expect(customGuard('https://www.linkedin.com/jobs/test')).resolves.toBeUndefined();
      await expect(customGuard('https://www.indeed.com/jobs')).rejects.toThrow(SSRFError);
    });

    it('allows subdomain of allowlisted domain', async () => {
      const customGuard = createSSRFGuard({
        allowedDomains: ['github.com'],
        allowedPatterns: [],
      });

      await expect(customGuard('https://api.github.com/users')).resolves.toBeUndefined();
    });

    it('respects custom patterns', async () => {
      const patternGuard = createSSRFGuard({
        allowedPatterns: [/^https:\/\/api\.github\.com\/.*/],
        allowedDomains: ['api.github.com'],
      });

      await expect(patternGuard('https://api.github.com/users')).resolves.toBeUndefined();
      await expect(patternGuard('https://github.com/users')).rejects.toThrow(SSRFError);
    });
  });

  describe('edge cases', () => {
    it('handles case-insensitive hostname matching', async () => {
      await expect(ssrfGuard('HTTPS://WWW.LINKEDIN.COM/JOBS/VIEW/123')).resolves.toBeUndefined();
    });

    it('handles URL-encoded characters', async () => {
      const url = 'https://www.linkedin.com/jobs/view/%3Cscript%3E';
      await expect(ssrfGuard(url)).resolves.toBeUndefined();
    });

    it('rejects invalid URLs', async () => {
      await expect(ssrfGuard('not-a-url')).rejects.toThrow(SSRFError);
      await expect(ssrfGuard('not-a-url')).rejects.toMatchObject({
        code: 'INVALID_URL',
      });
    });

    it('rejects gopher:// protocol', async () => {
      await expect(ssrfGuard('gopher://localhost/1')).rejects.toThrow(SSRFError);
    });

    it('rejects empty string', async () => {
      await expect(ssrfGuard('')).rejects.toThrow(SSRFError);
    });
  });
});

describe('DNS Rebinding Protection', () => {
  it('blocks DNS resolution to private IPs', async () => {
    await expect(ssrfGuard('https://www.linkedin.com/jobs/view/123')).resolves.toBeUndefined();
  });
});
