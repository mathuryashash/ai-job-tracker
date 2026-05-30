/**
 * env.ts — Centralized environment variable validation
 *
 * Uses Zod to validate required secrets at startup.
 * In non-development environments, the process will exit immediately
 * if any required variable is missing or fails validation.
 */
import { z } from 'zod';

/** Minimum secret length for adequate entropy (256-bit / 32 chars) */
const MIN_SECRET_LENGTH = 32;

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),

  JWT_SECRET: z
    .string()
    .min(MIN_SECRET_LENGTH, `JWT_SECRET must be at least ${MIN_SECRET_LENGTH} characters`),

  ENCRYPTION_KEY: z
    .string()
    .min(MIN_SECRET_LENGTH, `ENCRYPTION_KEY must be at least ${MIN_SECRET_LENGTH} characters`)
    .optional(),

  CLAUDE_API_KEY: z
    .string()
    .min(1, 'CLAUDE_API_KEY must not be empty')
    .optional(),

  OPENROUTER_API_KEY: z
    .string()
    .min(1, 'OPENROUTER_API_KEY must not be empty')
    .optional(),

  APIFY_API_KEY: z.string().optional(),
  JOOBLE_API_KEY: z.string().optional(),
  FLEXJOBS_API_KEY: z.string().optional(),
  INDEED_PUBLISHER_KEY: z.string().optional(),
  ADZUNA_APP_ID: z.string().optional(),
  ADZUNA_API_KEY: z.string().optional(),

  AUTH0_DOMAIN: z.string().optional(),
  AUTH0_AUDIENCE: z.string().optional(),

  DATABASE_URL: z.string().url('DATABASE_URL must be a valid URL').optional(),

  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_URL: z.string().optional(),

  FRONTEND_URL: z.string().url('FRONTEND_URL must be a valid URL').optional(),

  PORT: z.coerce.number().int().positive().default(3001),

  LOG_LEVEL: z.enum(['info', 'debug', 'warn', 'error']).default('info'),
  SCHEDULER_INTERVAL_MINUTES: z.coerce.number().int().positive().default(60),
  EXPOSE_ERROR_STACKS: z.preprocess((val) => val === 'true' || val === true, z.boolean()).default(false),
});

type Env = z.infer<typeof envSchema>;

let _env: Env | null = null;

/**
 * Parse and validate environment variables.
 * Call once at startup (before any other module that reads env vars).
 *
 * In production mode, exits the process with code 1 on validation failure.
 * In development/test mode, logs a warning but continues.
 */
export function validateEnv(): Env {
  if (_env) return _env;

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.errors
      .map((e) => `  • ${e.path.join('.')}: ${e.message}`)
      .join('\n');

    const message = `[env] Environment validation failed:\n${formatted}`;

    if (process.env.NODE_ENV === 'production') {
      console.error(message);
      console.error('[env] Exiting — refusing to start with invalid configuration.');
      process.exit(1);
    } else {
      // In dev/test, warn but don't exit so local development without all
      // prod secrets still works.
      console.warn(message);
      console.warn('[env] WARNING: Running with invalid/missing env vars (dev/test mode).');
    }
  }

  // Use a partial parse in dev so we at least get defaults
  _env = (result.success ? result.data : envSchema.parse({
    ...process.env,
    // Supply safe defaults only for dev so the app can boot
    JWT_SECRET: process.env.JWT_SECRET ?? 'dev-only-32-char-secret-do-not-use-in-prod',
    NODE_ENV: process.env.NODE_ENV ?? 'development',
  })) as Env;

  return _env;
}

/** Retrieve a validated env value. Throws if validateEnv() was not called first. */
export function env(): Env {
  if (!_env) {
    throw new Error('[env] validateEnv() must be called before accessing env()');
  }
  return _env;
}

/** Convenience accessor — validated JWT secret (never undefined after validation). */
export function getJwtSecret(): string {
  return env().JWT_SECRET;
}

/** Convenience accessor — validated or derived encryption key. */
export function getEncryptionKey(): string {
  const e = env();
  // Fall back to JWT_SECRET if ENCRYPTION_KEY is not separately set.
  // Both are validated to be >= 32 chars, so this is safe.
  return e.ENCRYPTION_KEY ?? e.JWT_SECRET;
}
