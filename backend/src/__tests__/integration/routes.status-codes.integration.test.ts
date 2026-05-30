import request from 'supertest';
import express, { Express } from 'express';
import { errorHandler } from '../../middleware/errorHandler';
import scraperRoutes from '../../routes/scraper.routes';
import automationRoutes from '../../routes/automation.routes';
import { AuthRequest } from '../../middleware/auth';

const mockGetAuthUserId = jest.fn();
const mockVerifyAuth0Token = jest.fn();
const mockPrismaUserFindUnique = jest.fn();
const mockPrismaResumeFindFirst = jest.fn();
const mockPrismaScrapedJobFindMany = jest.fn();
const mockPrismaScrapedJobCount = jest.fn();
const mockPrismaJobSourceFindMany = jest.fn();
const mockPrismaResumeFindMany = jest.fn();
const mockPrismaUserFindMany = jest.fn();

jest.mock('../../prisma/index', () => ({
  __esModule: true,
  default: {
    user: {
      findUnique: (...args: unknown[]) => mockPrismaUserFindUnique(...args),
      findMany: (...args: unknown[]) => mockPrismaUserFindMany(...args),
    },
    resume: {
      findFirst: (...args: unknown[]) => mockPrismaResumeFindFirst(...args),
      findMany: (...args: unknown[]) => mockPrismaResumeFindMany(...args),
    },
    scrapedJob: {
      findMany: (...args: unknown[]) => mockPrismaScrapedJobFindMany(...args),
      count: (...args: unknown[]) => mockPrismaScrapedJobCount(...args),
    },
    jobSource: {
      findMany: (...args: unknown[]) => mockPrismaJobSourceFindMany(...args),
    },
  },
}));

jest.mock('../../middleware/auth0', () => ({
  verifyAuth0Token: (...args: unknown[]) => mockVerifyAuth0Token(...args),
}));

jest.mock('../../services/auto-apply.service', () => ({
  runAutoApply: jest.fn().mockResolvedValue({ results: [] }),
  getAutomationStatus: jest.fn().mockResolvedValue({ running: false }),
}));

jest.mock('../../services/job-scraper.service', () => ({
  searchJobs: jest.fn().mockResolvedValue([]),
  getJobDescription: jest.fn().mockResolvedValue('Mock job description'),
}));

jest.mock('../../services/job-matching.service', () => ({
  matchResumeToJob: jest.fn().mockResolvedValue({ matchPercentage: 75 }),
}));

jest.mock('../../services/resume-tailoring.service', () => ({
  tailorResume: jest.fn().mockResolvedValue('Tailored resume content'),
}));

jest.mock('../../services/keyword-extraction.service', () => ({
  extractKeywordsFromResume: jest.fn().mockResolvedValue(['keyword1', 'keyword2']),
}));

jest.mock('../../services/scheduler.service', () => ({
  triggerAutomation: jest.fn().mockResolvedValue({ results: [] }),
}));

function createTestApp(): Express {
  const app = express();
  app.use(express.json());

  app.use((req: AuthRequest, _res, next) => {
    req.userId = mockGetAuthUserId();
    next();
  });

  app.use('/api/scraper', scraperRoutes);
  app.use('/api/automation', automationRoutes);
  app.use(errorHandler);

  return app;
}

describe('Route Error Status Codes', () => {
  let app: Express;

  beforeEach(() => {
    jest.clearAllMocks();
    app = createTestApp();
    
    mockGetAuthUserId.mockReturnValue('test-user-id');
    mockVerifyAuth0Token.mockResolvedValue({
      sub: 'test-user-id',
      email: 'test@example.com',
      name: 'Test User',
    });
    mockPrismaUserFindUnique.mockResolvedValue({
      id: 'test-user-id',
      email: 'test@example.com',
    });
  });

  describe('GET /api/scraper/jobs', () => {
    it('returns 200 for valid request', async () => {
      mockPrismaScrapedJobFindMany.mockResolvedValue([]);
      mockPrismaScrapedJobCount.mockResolvedValue(0);

      const response = await request(app)
        .get('/api/scraper/jobs')
        .set('Authorization', 'Bearer valid-token');

      expect(response.status).toBe(200);
    });

    it('returns 200 even with invalid page/limit (defaults applied)', async () => {
      mockPrismaScrapedJobFindMany.mockResolvedValue([]);
      mockPrismaScrapedJobCount.mockResolvedValue(0);

      const response = await request(app)
        .get('/api/scraper/jobs?page=-1&limit=abc');

      expect(response.status).toBe(200);
      expect(response.body.pagination.page).toBe(1);
      expect(response.body.pagination.limit).toBe(20);
    });

    it('returns 401 when userId is not set', async () => {
      mockGetAuthUserId.mockReturnValue(undefined);

      const response = await request(app)
        .get('/api/scraper/jobs');

      expect(response.status).toBe(401);
      expect(response.body.error).toContain('Unauthorized');
    });
  });

  describe('POST /api/scraper/trigger', () => {
    it('returns 400 for missing keywords', async () => {
      mockPrismaResumeFindFirst.mockResolvedValue({
        id: 'resume-1',
        extractedText: 'resume content',
      });

      const response = await request(app)
        .post('/api/scraper/trigger')
        .send({ location: 'remote' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation error');
    });

    it('returns 400 for empty keywords', async () => {
      const response = await request(app)
        .post('/api/scraper/trigger')
        .send({ keywords: '' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation error');
    });

    it('returns 404 when user not found', async () => {
      mockPrismaUserFindUnique.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/scraper/trigger')
        .send({ keywords: 'developer' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('User not found');
    });

    it('returns 400 when no resume with extracted text found', async () => {
      mockPrismaResumeFindFirst.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/scraper/trigger')
        .send({ keywords: 'developer' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('No resume');
    });

    it('returns 401 when userId is not set', async () => {
      mockGetAuthUserId.mockReturnValue(undefined);

      const response = await request(app)
        .post('/api/scraper/trigger')
        .send({ keywords: 'developer' });

      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/automation/status', () => {
    it('returns 200 for valid request', async () => {
      const response = await request(app)
        .get('/api/automation/status')
        .set('Authorization', 'Bearer valid-token');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('returns 401 when userId is not set', async () => {
      mockGetAuthUserId.mockReturnValue(undefined);

      const response = await request(app)
        .get('/api/automation/status');

      expect(response.status).toBe(401);
      expect(response.body.error).toContain('Unauthorized');
    });

    it('returns 500 when getAutomationStatus throws', async () => {
      const { getAutomationStatus } = require('../../services/auto-apply.service');
      (getAutomationStatus as jest.Mock).mockRejectedValueOnce(new Error('Database error'));

      const response = await request(app)
        .get('/api/automation/status');

      expect(response.status).toBe(500);
    });
  });

  describe('POST /api/automation/match', () => {
    it('returns 400 for missing jobDescription', async () => {
      const response = await request(app)
        .post('/api/automation/match')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation failed');
    });

    it('returns 400 when no resume found', async () => {
      mockPrismaResumeFindMany.mockResolvedValue([]);

      const response = await request(app)
        .post('/api/automation/match')
        .send({ jobDescription: 'Looking for a developer...' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('No resume found');
    });

    it('returns 401 when userId is not set', async () => {
      mockGetAuthUserId.mockReturnValue(undefined);

      const response = await request(app)
        .post('/api/automation/match')
        .send({ jobDescription: 'Looking for a developer...' });

      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/automation/search', () => {
    it('returns 200 for valid request', async () => {
      const response = await request(app)
        .get('/api/automation/search?keywords=developer');

      expect(response.status).toBe(200);
    });

    it('returns 400 for invalid query params', async () => {
      const response = await request(app)
        .get('/api/automation/search');

      expect(response.status).toBe(200);
    });

    it('returns 401 when userId is not set', async () => {
      mockGetAuthUserId.mockReturnValue(undefined);

      const response = await request(app)
        .get('/api/automation/search?keywords=developer');

      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/scraper/preferences', () => {
    it('returns 200 for valid request', async () => {
      mockPrismaJobSourceFindMany.mockResolvedValue([]);

      const response = await request(app)
        .get('/api/scraper/preferences');

      expect(response.status).toBe(200);
    });

    it('returns 401 when userId is not set', async () => {
      mockGetAuthUserId.mockReturnValue(undefined);

      const response = await request(app)
        .get('/api/scraper/preferences');

      expect(response.status).toBe(401);
    });
  });

  describe('POST /api/scraper/preferences', () => {
    it('returns 400 for invalid sources', async () => {
      const response = await request(app)
        .post('/api/scraper/preferences')
        .send({
          sources: [{ name: '', enabled: true }],
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation error');
    });

    it('returns 401 when userId is not set', async () => {
      mockGetAuthUserId.mockReturnValue(undefined);

      const response = await request(app)
        .post('/api/scraper/preferences')
        .send({ sources: [] });

      expect(response.status).toBe(401);
    });
  });

  describe('Error handler integration', () => {
    it('ZodError returns 400 status code', async () => {
      const testApp = express();
      testApp.use(express.json());
      
      testApp.get('/test-zod-error', (_req, _res, next) => {
        const { z } = require('zod');
        const schema = z.object({ name: z.string() });
        schema.parse({});
        next();
      });
      
      testApp.use(errorHandler);

      const response = await request(testApp).get('/test-zod-error');
      expect(response.status).toBe(400);
    });

    it('Custom AppError with statusCode is respected', async () => {
      const { createError } = require('../../middleware/errorHandler');
      
      const testApp = express();
      testApp.use(express.json());
      
      testApp.get('/test-app-error', (_req, _res, next) => {
        next(createError('Not Found', 404));
      });
      
      testApp.use(errorHandler);

      const response = await request(testApp).get('/test-app-error');
      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Not Found');
    });

    it('Prisma P2025 error returns 404', async () => {
      const testApp = express();
      testApp.use(express.json());
      
      testApp.get('/test-prisma-notfound', (_req, _res, next) => {
        const error = new Error('Record not found');
        (error as any).code = 'P2025';
        next(error);
      });
      
      testApp.use(errorHandler);

      const response = await request(testApp).get('/test-prisma-notfound');
      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Resource not found');
    });

    it('Prisma P2002 error returns 409', async () => {
      const testApp = express();
      testApp.use(express.json());
      
      testApp.get('/test-prisma-unique', (_req, _res, next) => {
        const error = new Error('Unique constraint');
        (error as any).code = 'P2002';
        next(error);
      });
      
      testApp.use(errorHandler);

      const response = await request(testApp).get('/test-prisma-unique');
      expect(response.status).toBe(409);
      expect(response.body.error).toContain('Duplicate');
    });
  });
});
