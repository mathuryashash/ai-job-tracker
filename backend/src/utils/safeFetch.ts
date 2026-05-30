import { ssrfConfig } from '../config/ssrf.config';
import { createSSRFGuard, type SSRFError } from './ssrf';

export interface SafeFetchOptions extends RequestInit {
  ssrfConfig?: {
    allowedDomains?: string[];
    allowedPatterns?: RegExp[];
  };
}

export interface SafeFetchResult {
  response: Response;
  aborted: boolean;
  truncated: boolean;
}

export async function safeFetch(
  url: string,
  options: SafeFetchOptions = {},
  guard?: (url: string) => Promise<void>
): Promise<Response> {
  const ssrfGuardFn = guard || createSSRFGuard({});
  await ssrfGuardFn(url);

  const timeout = ssrfConfig.timeout;
  const maxResponseSize = ssrfConfig.maxResponseSize;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok && response.status >= 400) {
      console.warn(`safeFetch: HTTP ${response.status} for ${url}`);
    }

    return response;
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new Error(`Request timed out after ${timeout}ms: ${url}`);
      }
      throw error;
    }

    throw error;
  }
}

export async function safeFetchText(
  url: string,
  options: SafeFetchOptions = {},
  guard?: (url: string) => Promise<void>
): Promise<{ text: string; aborted: boolean; truncated: boolean }> {
  const ssrfGuardFn = guard || createSSRFGuard({});
  await ssrfGuardFn(url);

  const timeout = ssrfConfig.timeout;
  const maxResponseSize = ssrfConfig.maxResponseSize;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const reader = response.body?.getReader();
    if (!reader) {
      const text = await response.text();
      return { text, aborted: false, truncated: false };
    }

    const chunks: Uint8Array[] = [];
    let totalSize = 0;
    let aborted = false;

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        const chunkSize = value.length;
        if (totalSize + chunkSize > maxResponseSize) {
          const remaining = maxResponseSize - totalSize;
          if (remaining > 0) {
            chunks.push(value.slice(0, remaining));
          }
          aborted = true;
          controller.abort();
          break;
        }

        chunks.push(value);
        totalSize += chunkSize;
      }
    } catch (readError) {
      if (readError instanceof Error && readError.name === 'AbortError') {
        aborted = true;
      } else {
        throw readError;
      }
    }

    const decoder = new TextDecoder();
    const text = chunks.map(chunk => decoder.decode(chunk, { stream: false })).join('');

    return { text, aborted, truncated: aborted };
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new Error(`Request timed out after ${timeout}ms: ${url}`);
      }
      throw error;
    }

    throw error;
  }
}

export function isSSRFError(error: unknown): error is SSRFError {
  return error instanceof Error && error.name === 'SSRFError';
}
