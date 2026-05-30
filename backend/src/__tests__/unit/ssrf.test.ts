import { isPrivateIP } from '../../utils/ssrf';

describe('SSRF Guard', () => {
  describe('isPrivateIP', () => {
    it('blocks localhost IPv4', () => {
      expect(isPrivateIP('127.0.0.1')).toBe(true);
      expect(isPrivateIP('127.0.0.2')).toBe(true);
    });

    it('blocks localhost IPv6', () => {
      expect(isPrivateIP('::1')).toBe(true);
      expect(isPrivateIP('::ffff:127.0.0.1')).toBe(true);
    });

    it('blocks 10.0.0.0/8 range', () => {
      expect(isPrivateIP('10.0.0.1')).toBe(true);
      expect(isPrivateIP('10.255.255.255')).toBe(true);
    });

    it('blocks 172.16.0.0/12 range', () => {
      expect(isPrivateIP('172.16.0.1')).toBe(true);
      expect(isPrivateIP('172.31.255.255')).toBe(true);
      expect(isPrivateIP('172.20.0.1')).toBe(true);
    });

    it('blocks 192.168.0.0/16 range', () => {
      expect(isPrivateIP('192.168.0.1')).toBe(true);
      expect(isPrivateIP('192.168.255.255')).toBe(true);
    });

    it('blocks 169.254.0.0/16 link-local range', () => {
      expect(isPrivateIP('169.254.0.1')).toBe(true);
      expect(isPrivateIP('169.254.255.255')).toBe(true);
    });

    it('blocks 0.0.0.0/8 range', () => {
      expect(isPrivateIP('0.0.0.0')).toBe(true);
    });

    it('allows public IP addresses', () => {
      expect(isPrivateIP('8.8.8.8')).toBe(false);
      expect(isPrivateIP('1.1.1.1')).toBe(false);
      expect(isPrivateIP('203.0.113.1')).toBe(false);
    });

    it('blocks IPv6 private addresses (fc00, fd00)', () => {
      expect(isPrivateIP('fc00::1')).toBe(true);
      expect(isPrivateIP('fd00::1')).toBe(true);
    });

    it('blocks IPv6 link-local addresses (fe80)', () => {
      expect(isPrivateIP('fe80::1')).toBe(true);
    });

    it('blocks mapped IPv4 addresses in IPv6', () => {
      expect(isPrivateIP('::ffff:10.0.0.1')).toBe(true);
      expect(isPrivateIP('::ffff:192.168.1.1')).toBe(true);
      expect(isPrivateIP('::ffff:172.20.0.1')).toBe(true);
    });
  });
});
