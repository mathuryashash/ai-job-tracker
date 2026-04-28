import express, { Request } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import { errorHandler } from './middleware/errorHandler';
import { requestLogger } from './middleware/requestLogger';
import resumeRoutes from './routes/resume.routes';
import applicationRoutes from './routes/application.routes';
import coverLetterRoutes from './routes/coverLetter.routes';
import activityRoutes from './routes/activity.routes';
import authRoutes from './routes/auth.routes';
import scraperRoutes from './routes/scraper.routes';
import automationRoutes from './routes/automation.routes';
import { initQueues } from './queues/index';
import { initScheduler, stopScheduler } from './services/scheduler.service';
import { initWebSocket } from './services/websocket';
import { requireAuth, devAuthMiddleware, AuthRequest } from './middleware/auth';
import prisma from './prisma/index';

dotenv.config();

if (process.env.NODE_ENV === 'production') {
   const required = ['DATABASE_URL', 'REDIS_HOST', 'REDIS_PORT', 'JWT_SECRET'];
   const missing = required.filter(key => !process.env[key]);
   if (missing.length > 0) {
     throw new Error(`Missing required environment variables in production: ${missing.join(', ')}`);
   }
 }
 
 // Validate FRONTEND_URL format if provided
 if (process.env.FRONTEND_URL) {
   try {
     new URL(process.env.FRONTEND_URL);
   } catch (error) {
     throw new Error(`Invalid FRONTEND_URL format: ${process.env.FRONTEND_URL}`);
   }
 }

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
  console.warn('CORS configured with no allowed origins in production environment!');
}

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(requestLogger);

const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

// Per-user limiters applied after auth middleware so req.userId is populated
const scraperUserLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => (req as AuthRequest).userId || req.ip || 'unknown',
  message: { success: false, error: 'Too many scraper requests, please slow down' },
});

const automationUserLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => (req as AuthRequest).userId || req.ip || 'unknown',
  message: { success: false, error: 'Too many automation requests, please slow down' },
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
    const server = app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });

    // Initialize WebSocket server
    initWebSocket(server);

    process.on('SIGTERM', () => {
      stopScheduler();
      server.close(() => process.exit(0));
    });

    process.on('SIGINT', () => {
      stopScheduler();
      server.close(() => process.exit(0));
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

export default app;
