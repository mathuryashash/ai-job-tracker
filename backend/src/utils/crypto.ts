import crypto from 'crypto';
import { getEncryptionKey as getEnvEncryptionKey } from '../config/env';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Get the encryption key from environment variables via centralized env validator.
 * ENCRYPTION_KEY is preferred; falls back to JWT_SECRET when not separately set.
 * The key is hashed with SHA-256 to produce a 32-byte key for AES-256.
 * Both ENCRYPTION_KEY and JWT_SECRET are validated to be >= 32 chars by env.ts.
 */
export function getEncryptionKey(): Buffer {
  const key = getEnvEncryptionKey();
  return crypto.createHash('sha256').update(key).digest();
}

/**
 * Encrypt API keys using AES-256-GCM.
 * Returns a string in format: iv:authTag:encryptedData (all in hex)
 */
export function encryptApiKeys(apiKeys: Record<string, unknown>): string {
  const json = JSON.stringify(apiKeys);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  
  const encrypted = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  
  return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted.toString('hex');
}

/**
 * Decrypt API keys that were encrypted with encryptApiKeys.
 * Handles backward compatibility - throws error for invalid format
 * (which could indicate unencrypted legacy data)
 */
export function decryptApiKeys(encryptedData: string): Record<string, unknown> {
  const parts = encryptedData.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted data format');
  }
  
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = Buffer.from(parts[2], 'hex');
  
  const decipher = crypto.createDecipheriv(ALGORITHM, getEncryptionKey(), iv);
  decipher.setAuthTag(authTag);
  
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8'));
}

/**
 * Check if a value appears to be encrypted (has the expected format).
 * The encrypted format is iv:authTag:encrypted where all are hex strings.
 */
export function isEncrypted(value: string): boolean {
  const parts = value.split(':');
  if (parts.length !== 3) {
    return false;
  }
  
  // All parts should be valid hex strings
  return parts.every(part => {
    if (!part) return false;
    return /^[0-9a-fA-F]+$/.test(part);
  });
}

/**
 * Try to decrypt API keys, with fallback to return as-is if not encrypted.
 * This handles backward compatibility with existing unencrypted data.
 */
export function tryDecryptApiKeys(data: unknown): Record<string, unknown> {
  // If it's already an object (not a string), return it as-is
  if (typeof data !== 'string') {
    if (typeof data === 'object' && data !== null) {
      return data as Record<string, unknown>;
    }
    return {};
  }
  
  // Try to decrypt if it looks encrypted
  if (isEncrypted(data)) {
    try {
      return decryptApiKeys(data);
    } catch {
      // If decryption fails, return empty object
      console.warn('Failed to decrypt API keys, returning empty object');
      return {};
    }
  }
  
  // If it looks like plain JSON object, try to parse it
  try {
    const parsed = JSON.parse(data);
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed;
    }
  } catch {
    // Not valid JSON either
  }
  
  return {};
}