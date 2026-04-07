import { Router, Response } from 'express';
import { z, ZodError } from 'zod';
import prisma from '../prisma/index';
import { getAuthUserId, AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { runAutoApply } from '../services/auto-apply.service';

const router = Router();

// ── Validation Schemas ──

const triggerSchema = z.object({
  keywords: z.string().min(1),
  location: z.string().default('remote'),
  remoteOnly: z.boolean().default(true),
  matchThreshold: z.number().min(0).max(100).default(70),
});

const preferencesSchema = z.object({
  sources: z.array(
    z.object({
      name: z.string(),
      enabled: z.boolean().default(true),
      keywords: z.array(z.string()),
      location: z.string().default('remote'),
      remoteOnly: z.boolean().default(true),
    })
  ),
});

// ── POST /api/scraper/trigger — Start a manual scrape ──

router.post('/trigger', async (req: AuthRequest, res: Response) => {
  try {
    const userId = getAuthUserId(req);
    if (!userId) {
      throw createError('Unauthorized', 401);
    }

    const config = triggerSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw createError('User not found', 404);
    }

    const resume = await prisma.resume.findFirst({
      where: { userId, extractedText: { not: null } },
      orderBy: { createdAt: 'desc' },
    });
    if (!resume) {
      throw createError('No resume with extracted text found. Please upload a resume first.', 400);
    }

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
      totalProcessed: result.length,
      applicationsCreated: result.filter((r) => r.applicationCreated).length,
      config: {
        keywords: config.keywords,
        location: config.location,
        remoteOnly: config.remoteOnly,
        matchThreshold: config.matchThreshold,
      },
    });
  } catch (error) {
    if (error instanceof ZodError) {
      res.status(400).json({ success: false, error: 'Validation error', details: error.errors });
      return;
    }
    console.error('Trigger error:', error);
    res.status(500).json({ success: false, error: 'Failed to trigger scraping' });
  }
});

// ── POST /api/scraper/stop — Pause automated scraping ──
// TODO: Implement stop scraping functionality

router.post('/stop', async (req: AuthRequest, res: Response) => {
  try {
    const userId = getAuthUserId(req);
    if (!userId) {
      throw createError('Unauthorized', 401);
    }

    throw createError('Stop scraping is not implemented yet', 501);
  } catch (error) {
    console.error('Stop scraping error:', error);
    const statusCode = (error as any)?.statusCode || 500;
    res.status(statusCode).json({ success: false, error: (error as Error).message || 'Failed to stop scraping' });
  }
});

// ── POST /api/scraper/resume — Resume automated scraping ──
// TODO: Implement resume scraping functionality

router.post('/resume', async (req: AuthRequest, res: Response) => {
  try {
    const userId = getAuthUserId(req);
    if (!userId) {
      throw createError('Unauthorized', 401);
    }

    throw createError('Resume scraping is not implemented yet', 501);
  } catch (error) {
    console.error('Resume scraping error:', error);
    const statusCode = (error as any)?.statusCode || 500;
    res.status(statusCode).json({ success: false, error: (error as Error).message || 'Failed to resume scraping' });
  }
});

// ── GET /api/scraper/status — Check queue status ──
// TODO: Implement queue status checking

router.get('/status', async (req: AuthRequest, res: Response) => {
  try {
    const userId = getAuthUserId(req);
    if (!userId) {
      throw createError('Unauthorized', 401);
    }

    res.status(501).json({ 
      success: false,
      error: 'Queue status endpoint is not implemented yet',
      message: 'This feature will be available in a future update'
    });
  } catch (error) {
    console.error('Status check error:', error);
    res.status(500).json({ success: false, error: 'Failed to check status' });
  }
});

// ── GET /api/scraper/jobs — List scraped jobs for a user ──

router.get('/jobs', async (req: AuthRequest, res: Response) => {
  try {
    const userId = getAuthUserId(req);
    if (!userId) {
      throw createError('Unauthorized', 401);
    }

    const page = Math.max(parseInt(req.query.page as string) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const status = req.query.status as string;
    const minScore = parseInt(req.query.minScore as string) || 0;

    const where: any = { userId };
    if (status) where.status = status;
    if (minScore > 0) where.matchScore = { gte: minScore };

    const [jobs, total] = await Promise.all([
      prisma.scrapedJob.findMany({
        where,
        orderBy: [{ matchScore: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.scrapedJob.count({ where }),
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
    console.error('List jobs error:', error);
    res.status(500).json({ success: false, error: 'Failed to list scraped jobs' });
  }
});

// ── POST /api/scraper/preferences — Set/update scraping sources ──

router.post('/preferences', async (req: AuthRequest, res: Response) => {
  try {
    const userId = getAuthUserId(req);
    if (!userId) {
      throw createError('Unauthorized', 401);
    }

    const { sources } = preferencesSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw createError('User not found', 404);
    }

    const created = await prisma.$transaction(async (tx) => {
      await tx.jobSource.deleteMany({ where: { userId } });
      return Promise.all(
        sources.map((source) =>
          tx.jobSource.create({
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

    res.json({
      success: true,
      message: 'Preferences saved',
      data: created,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      res.status(400).json({ success: false, error: 'Validation error', details: error.errors });
      return;
    }
    console.error('Preferences error:', error);
    res.status(500).json({ success: false, error: 'Failed to save preferences' });
  }
});

// ── GET /api/scraper/preferences — Get scraping preferences ──

router.get('/preferences', async (req: AuthRequest, res: Response) => {
  try {
    const userId = getAuthUserId(req);
    if (!userId) {
      throw createError('Unauthorized', 401);
    }

    const sources = await prisma.jobSource.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, data: sources });
  } catch (error) {
    console.error('Get preferences error:', error);
    res.status(500).json({ success: false, error: 'Failed to get preferences' });
  }
});

export default router;
