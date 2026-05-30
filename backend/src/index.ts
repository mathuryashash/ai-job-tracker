import express, { Request } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { errorHandler } from './middleware/errorHandler';
import { requestLogger } from './middleware/requestLogger';
import resumeRoutes from './routes/resume.routes';
import applicationRoutes from './routes/application.routes';
import coverLetterRoutes from './routes/coverLetter.routes';
import activityRoutes from './routes/activity.routes';
import authRoutes from './routes/auth.routes';
import scraperRoutes from './routes/scraper.routes';
import automationRoutes from './routes/automation.routes';
import { initQueues, connection as redisConnection } from './queues/index';
import { initScheduler, stopScheduler } from './services/scheduler.service';
import { initWebSocket } from './services/websocket';
import { requireAuth, devAuthMiddleware, AuthRequest } from './middleware/auth';
import prisma from './prisma/index';
import { validateEnv } from './config/env';
import { startAutomationWorker, stopAutomationWorker } from './workers/automation.worker';

// ─── Validate environment variables FIRST — before any other initialisation ───
dotenv.config();
validateEnv();


const app = express();
const PORT = process.env.PORT || 3001;

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
      },
    },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  })
);

let allowedOrigins: string[] = [];

if (process.env.FRONTEND_URL) {
  try {
    const url = new URL(process.env.FRONTEND_URL);
    allowedOrigins = [url.origin];
    console.log(`CORS configured to allow origin: ${url.origin}`);
  } catch (error: any) {
    console.error(`Invalid FRONTEND_URL: ${process.env.FRONTEND_URL}. Falling back to development origins.`);
    if (process.env.NODE_ENV === 'development') {
      allowedOrigins = ['http://localhost:5173', 'http://localhost:3000'];
    }
  }
} else if (process.env.NODE_ENV === 'development') {
  allowedOrigins = ['http://localhost:5173', 'http://localhost:3000'];
  console.log('CORS configured for development: allowing localhost origins');
} else {
  throw new Error('FRONTEND_URL environment variable is required in production. Set FRONTEND_URL to your frontend URL (e.g., https://yourdomain.com)');
}

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(requestLogger);

// ─── Redis-backed rate limiters ──────────────────────────────────────────────
// Using the same IORedis connection that BullMQ uses so we don't open extra
// TCP connections to Redis. rate-limit-redis v5 requires a `sendCommand`
// wrapper around the ioredis client.
function makeRedisStore(prefix: string): RedisStore {
  return new RedisStore({
    sendCommand: (...args: string[]) =>
      (redisConnection as any).call(...args),
    prefix,
  });
}

const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 100,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  store: makeRedisStore('rl:general:'),
});

const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  store: makeRedisStore('rl:auth:'),
});

// Per-user limiters applied after auth middleware so req.userId is populated
const scraperUserLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req: Request) => (req as AuthRequest).userId || req.ip || 'unknown',
  message: { success: false, error: 'Too many scraper requests, please slow down' },
  store: makeRedisStore('rl:scraper:'),
});

const automationUserLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 15,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req: Request) => (req as AuthRequest).userId || req.ip || 'unknown',
  message: { success: false, error: 'Too many automation requests, please slow down' },
  store: makeRedisStore('rl:automation:'),
  skip: (req) => {
    // Allow bypass in test environments
    return process.env.NODE_ENV === 'test';
  },
});


app.use('/api/auth', authLimiter);
app.use('/api', generalLimiter);

app.use('/api/auth', authRoutes);
app.use('/api/resumes', devAuthMiddleware, requireAuth, resumeRoutes);
app.use('/api/applications', devAuthMiddleware, requireAuth, applicationRoutes);
app.use('/api/cover-letters', devAuthMiddleware, requireAuth, coverLetterRoutes);
app.use('/api/activities', devAuthMiddleware, requireAuth, activityRoutes);
app.use('/api/scraper', devAuthMiddleware, requireAuth, scraperUserLimiter, scraperRoutes);
app.use('/api/automation', devAuthMiddleware, requireAuth, automationUserLimiter, automationRoutes);

// Test endpoint without auth
app.get('/api/test-auth', devAuthMiddleware, (req, res) => {
  res.json({ 
    success: true, 
    userId: (req as any).userId || 'NOT_SET',
    message: 'Auth test endpoint'
  });
});

app.get('/api/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', db: 'connected', timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('Health check failed:', error);
    res.json({ status: 'error', db: 'disconnected', error: String(error), timestamp: new Date().toISOString() });
  }
});

app.use(errorHandler);

async function startServer() {
  try {
    await initQueues();
    initScheduler();
    startAutomationWorker(); // Phase 2: async automation via BullMQ
    const server = app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });

    // Initialize WebSocket server
    initWebSocket(server);

    const gracefulShutdown = async () => {
      stopScheduler();
      await stopAutomationWorker();
      server.close(() => process.exit(0));
    };

    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

export default app;
