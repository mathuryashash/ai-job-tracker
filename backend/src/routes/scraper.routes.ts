import { Router, Response, NextFunction } from 'express';
import { z, ZodError } from 'zod';
import prisma from '../prisma/index';
import { getAuthUserId, AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { runAutoApply } from '../services/auto-apply.service';
import {
  MATCH_THRESHOLD_DEFAULT,
  PAGINATION_DEFAULT_LIMIT,
  PAGINATION_MAX_LIMIT,
} from '../config/constants';

const router = Router();

type ScraperPrismaAccess = {
  scrapedJob: {
    findMany: (args: {
      where: Record<string, unknown>;
      orderBy: Array<Record<string, 'asc' | 'desc'>>;
      skip: number;
      take: number;
    }) => Promise<unknown[]>;
    count: (args: { where: Record<string, unknown> }) => Promise<number>;
  };
  jobSource: {
    deleteMany: (args: { where: { userId: string } }) => Promise<unknown>;
    create: (args: {
      data: {
        userId: string;
        name: string;
        enabled: boolean;
        keywords: string[];
        location: string;
        remoteOnly: boolean;
      };
    }) => Promise<unknown>;
    findMany: (args: {
      where: { userId: string };
      orderBy: { createdAt: 'asc' | 'desc' };
    }) => Promise<unknown[]>;
  };
};

const scraperPrisma = prisma as unknown as ScraperPrismaAccess;

// ── Validation Schemas ──

const triggerSchema = z.object({
  keywords: z.string().min(1),
  location: z.string().default('remote'),
  remoteOnly: z.boolean().default(true),
  matchThreshold: z.number().min(0).max(100).default(MATCH_THRESHOLD_DEFAULT),
});

const preferencesSchema = z.object({
  sources: z
    .array(
      z.object({
        name: z.string().min(1).max(100),
        enabled: z.boolean().default(true),
        keywords: z.array(z.string().min(1).max(100)).max(20),
        location: z.string().max(100).default('remote'),
        remoteOnly: z.boolean().default(true),
      })
    )
    .max(20),
});

// ── POST /api/scraper/trigger — Start a manual scrape ──

router.post('/trigger', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = getAuthUserId(req);
    if (!userId) throw createError('Unauthorized', 401);

    const config = triggerSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw createError('User not found', 404);

    const resume = await prisma.resume.findFirst({
      where: { userId, extractedText: { not: null } },
      orderBy: { createdAt: 'desc' },
    });
    if (!resume) throw createError('No resume with extracted text found. Please upload a resume first.', 400);

    const result = await runAutoApply({
      userId,
      keywords: config.keywords,
      location: config.location,
      matchThreshold: config.matchThreshold,
      autoTailorResume: true,
      autoGenerateCoverLetter: true,
    });

    res.json({
      success: true,
      message: 'Job scraping triggered',
      totalProcessed: result.results.length,
      applicationsCreated: result.results.filter((r) => r.applicationCreated).length,
      config: {
        keywords: config.keywords,
        location: config.location,
        remoteOnly: config.remoteOnly,
        matchThreshold: config.matchThreshold,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ── POST /api/scraper/stop — Pause automated scraping ──

router.post('/stop', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = getAuthUserId(req);
    if (!userId) throw createError('Unauthorized', 401);
    throw createError('Stop scraping is not implemented yet', 501);
  } catch (error) {
    next(error);
  }
});

// ── POST /api/scraper/resume — Resume automated scraping ──

router.post('/resume', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = getAuthUserId(req);
    if (!userId) throw createError('Unauthorized', 401);
    throw createError('Resume scraping is not implemented yet', 501);
  } catch (error) {
    next(error);
  }
});

// ── GET /api/scraper/status — Check queue status ──

router.get('/status', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = getAuthUserId(req);
    if (!userId) throw createError('Unauthorized', 401);
    throw createError('Queue status endpoint is not implemented yet', 501);
  } catch (error) {
    next(error);
  }
});

// ── GET /api/scraper/jobs — List scraped jobs for a user ──

router.get('/jobs', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = getAuthUserId(req);
    if (!userId) throw createError('Unauthorized', 401);

    const page = Math.max(parseInt(req.query.page as string) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit as string) || PAGINATION_DEFAULT_LIMIT, PAGINATION_MAX_LIMIT);
    const status = req.query.status as string;
    const minScore = parseInt(req.query.minScore as string) || 0;

    const where: Record<string, unknown> = { userId };
    if (status) where.status = status;
    if (minScore > 0) where.matchScore = { gte: minScore };

    const [jobs, total] = await Promise.all([
      scraperPrisma.scrapedJob.findMany({
        where,
        orderBy: [{ matchScore: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      scraperPrisma.scrapedJob.count({ where }),
    ]);

    res.json({
      success: true,
      data: jobs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    next(error);
  }
});

// ── POST /api/scraper/preferences — Set/update scraping sources ──

router.post('/preferences', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = getAuthUserId(req);
    if (!userId) throw createError('Unauthorized', 401);

    const { sources } = preferencesSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw createError('User not found', 404);

    const created = await prisma.$transaction(async (tx) => {
      const txWithSources = tx as unknown as Pick<ScraperPrismaAccess, 'jobSource'>;
      await txWithSources.jobSource.deleteMany({ where: { userId } });
      return Promise.all(
        sources.map((source) =>
          txWithSources.jobSource.create({
            data: {
              userId,
              name: source.name,
              enabled: source.enabled,
              keywords: source.keywords,
              location: source.location,
              remoteOnly: source.remoteOnly,
            },
          })
        )
      );
    });

    res.json({ success: true, message: 'Preferences saved', data: created });
  } catch (error) {
    next(error);
  }
});

// ── GET /api/scraper/preferences — Get scraping preferences ──

router.get('/preferences', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = getAuthUserId(req);
    if (!userId) throw createError('Unauthorized', 401);

    const sources = await scraperPrisma.jobSource.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, data: sources });
  } catch (error) {
    next(error);
  }
});

export default router;
