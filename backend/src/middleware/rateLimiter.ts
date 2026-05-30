import rateLimit, { RateLimitRequestHandler } from 'express-rate-limit';
import { Request } from 'express';
import { AuthRequest } from './auth';

/**
 * Rate limiting middleware for different endpoints.
 * Uses standardHeaders (RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset)
 */

type AuthReq = Request & Partial<AuthRequest>;

// Key generator that uses userId if available, falls back to IP
const keyGenerator = (req: AuthReq): string => {
  return req.userId || req.ip || 'unknown';
};

// API keys retrieval: 30 requests per minute (more permissive for fetching keys)
export const apiKeysLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { success: false, error: 'Too many requests for API keys. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator,
});

// Job search: 10 requests per minute per user
export const jobSearchLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  message: { success: false, error: 'Rate limit exceeded for job search. Try again in a minute.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator,
});

// Automation trigger: 10 requests per minute per user (increased from 3 for better UX)
export const automationLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { success: false, error: 'Automation already running. Wait for it to complete.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator,
  skip: (req) => {
    // Allow bypass in test/development environments
    return process.env.NODE_ENV === 'test';
  },
});

// General API: 100 requests per minute per IP
export const generalLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { success: false, error: 'Too many requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator,
});

// Stricter limiter for auth endpoints (login, etc.)
export const authLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { success: false, error: 'Too many authentication attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator,
});

// Limiter for scraper endpoints
export const scraperLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { success: false, error: 'Too many scraper requests, please slow down' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator,
});

// Automation endpoint limiter (general automation endpoints)
export const automationEndpointLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { success: false, error: 'Too many automation requests, please slow down' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator,
});