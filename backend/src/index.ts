import express from 'express';
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
import { requireAuth } from './middleware/auth';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(requestLogger);

const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});

const automationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip || 'unknown',
});

const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/auth', authLimiter);
app.use('/api', generalLimiter);

app.use('/api/auth', authRoutes);
app.use('/api/resumes', requireAuth, resumeRoutes);
app.use('/api/applications', requireAuth, applicationRoutes);
app.use('/api/cover-letters', requireAuth, coverLetterRoutes);
app.use('/api/activities', requireAuth, activityRoutes);
app.use('/api/scraper', requireAuth, scraperRoutes);
app.use('/api/automation', requireAuth, automationLimiter, automationRoutes);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use(errorHandler);

async function startServer() {
  try {
    await initQueues();
    initScheduler();
    const server = app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });

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
