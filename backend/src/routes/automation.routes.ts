import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { triggerAutomation } from '../services/scheduler.service';
import { getAutomationStatus } from '../services/auto-apply.service';
import { searchJobs, getJobDescription } from '../services/job-scraper.service';
import { matchResumeToJob } from '../services/job-matching.service';
import { tailorResume } from '../services/resume-tailoring.service';
import { extractKeywordsFromResume } from '../services/keyword-extraction.service';
import { getJobRecommendations } from '../services/recommendation.service';
import prisma from '../prisma/index';
import { getAuthUserId } from '../middleware/auth';
import { ssrfGuard, SSRFError } from '../utils/ssrf';
import { encryptApiKeys, tryDecryptApiKeys } from '../utils/crypto';
import { jobSearchLimiter, automationLimiter } from '../middleware/rateLimiter';

const router = Router();

const triggerSchema = z.object({
  keywords: z.string().optional(),
  location: z.string().optional(),
  remote: z.coerce.boolean().optional(),
  matchThreshold: z.number().min(0).max(100).default(70),
  autoTailorResume: z.boolean().default(true),
  autoGenerateCoverLetter: z.boolean().default(true),
  useAIKeywords: z.boolean().default(true),
});

const searchSchema = z.object({
  keywords: z.string().optional(),
  location: z.string().optional(),
  remote: z.coerce.boolean().optional(),
  fullTime: z.coerce.boolean().optional(),
});

const matchSchema = z.object({
  jobDescription: z.string().min(1).max(20000),
});

const tailorSchema = z.object({
  jobDescription: z.string().min(1).max(20000),
  resumeId: z.string().optional(),
});

const jobUrlSchema = z.string().url().refine((value) => {
  const parsed = new URL(value);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return false;
  }
  return true;
}, 'Invalid URL');

router.post('/trigger', automationLimiter, async (req: Request, res: Response) => {
  try {
    const userId = getAuthUserId(req);
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const data = triggerSchema.parse(req.body);

    const automationResult = await triggerAutomation(
      userId,
      data.keywords,
      data.location,
      data.matchThreshold,
      data.autoTailorResume,
      data.autoGenerateCoverLetter,
      data.useAIKeywords,
      data.remote
    );

    const { results, extractedKeywords, sourceStats } = automationResult;

    res.json({
      success: true,
      data: {
        totalJobs: results.length,
        applicationsCreated: results.filter(r => r.applicationCreated).length,
        sourceStats,
        extractedKeywords,
        results: results.map(r => ({
          jobTitle: r.job.title,
          company: r.job.company,
          matchPercentage: r.matchResult.matchPercentage,
          applicationCreated: r.applicationCreated,
          applicationId: r.applicationId,
          source: r.job.source,
          coverLetter: r.coverLetter,
          error: r.error,
        })),
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Validation failed', details: error.errors });
      return;
    }
    console.error('Automation error:', error);
    res.status(500).json({ success: false, error: 'Failed to run automation' });
  }
});

router.get('/status', async (req: Request, res: Response) => {
  try {
    const userId = getAuthUserId(req);
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const status = await getAutomationStatus(userId);

    res.json({ success: true, data: status });
  } catch (error) {
    console.error('Status error:', error);
    res.status(500).json({ success: false, error: 'Failed to get automation status' });
  }
});

router.get('/search', jobSearchLimiter, async (req: Request, res: Response) => {
  try {
    const userId = getAuthUserId(req);
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const data = searchSchema.parse(req.query);

    // Fetch user's API keys and decrypt
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { preferences: true },
    });
    // Use tryDecryptApiKeys for backward compatibility with unencrypted data
    const userApiKeys = tryDecryptApiKeys((user?.preferences as any)?.apiKeys);

    const jobs = await searchJobs(
      {
        keywords: data.keywords,
        location: data.location,
        remote: data.remote,
        fullTime: data.fullTime,
      },
      userApiKeys
    );

    res.json({ success: true, data: jobs });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Validation failed', details: error.errors });
      return;
    }
    console.error('Search error:', error);
    res.status(500).json({ success: false, error: 'Failed to search jobs' });
  }
});

router.post('/match', async (req: Request, res: Response) => {
  try {
    const userId = getAuthUserId(req);
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const data = matchSchema.parse(req.body);

    const resumes = await prisma.resume.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });

    if (resumes.length === 0) {
      res.status(400).json({ success: false, error: 'No resume found' });
      return;
    }

    const resume = resumes[0];
    const resumeText = resume.extractedText || '';

    const matchResult = await matchResumeToJob(resumeText, data.jobDescription);

    res.json({ success: true, data: matchResult });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Validation failed', details: error.errors });
      return;
    }
    console.error('Match error:', error);
    res.status(500).json({ success: false, error: 'Failed to match resume to job' });
  }
});

router.post('/tailor', async (req: Request, res: Response) => {
  try {
    const userId = getAuthUserId(req);
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const data = tailorSchema.parse(req.body);

    let resumeText = '';
    
    if (data.resumeId) {
      const resume = await prisma.resume.findUnique({
        where: { id: data.resumeId },
      });
      if (resume) {
        if (resume.userId !== userId) {
          res.status(403).json({ success: false, error: 'Forbidden' });
          return;
        }
        resumeText = resume.extractedText || '';
      }
    } else {
      const resumes = await prisma.resume.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 1,
      });
      if (resumes.length > 0) {
        resumeText = resumes[0].extractedText || '';
      }
    }

    if (!resumeText) {
      res.status(400).json({ success: false, error: 'No resume found' });
      return;
    }

    const tailoredResume = await tailorResume(resumeText, data.jobDescription);

    res.json({ success: true, data: tailoredResume });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Validation failed', details: error.errors });
      return;
    }
    console.error('Tailor error:', error);
    res.status(500).json({ success: false, error: 'Failed to tailor resume' });
  }
});

router.get('/jobs', async (req: Request, res: Response) => {
  try {
    const userId = getAuthUserId(req);
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const { url } = req.query;
    if (!url || typeof url !== 'string') {
      res.status(400).json({ success: false, error: 'Job URL is required' });
      return;
    }

    const safeUrl = jobUrlSchema.parse(url);

    try {
      await ssrfGuard(safeUrl);
    } catch (guardError) {
      if (guardError instanceof SSRFError) {
        res.status(400).json({ success: false, error: `SSRF protection: ${guardError.reason}` });
        return;
      }
      throw guardError;
    }

    const description = await getJobDescription(safeUrl);

    res.json({ success: true, data: { description } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Invalid URL' });
      return;
    }
    console.error('Job fetch error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch job description' });
  }
});

// Extract keywords from user's resume
router.post('/extract-keywords', async (req: Request, res: Response) => {
  try {
    const userId = getAuthUserId(req);
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const resumes = await prisma.resume.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });

    if (resumes.length === 0) {
      res.status(400).json({ success: false, error: 'No resume found. Upload a resume first.' });
      return;
    }

    const resumeText = resumes[0].extractedText || '';
    if (!resumeText) {
      res.status(400).json({ success: false, error: 'Resume has no extracted text' });
      return;
    }

    const keywords = await extractKeywordsFromResume(resumeText);
    res.json({ success: true, data: keywords });
  } catch (error) {
    console.error('Keyword extraction error:', error);
    res.status(500).json({ success: false, error: 'Failed to extract keywords' });
  }
});

// List all job sources
router.get('/sources', async (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: [
      { name: 'Apify', type: 'scraping', requiresKey: true, description: 'Use Apify to scrape LinkedIn, Indeed, Internshala, and more' },
      { name: 'Remotive', type: 'api', requiresKey: false, description: 'Remote job board (free API)' },
      { name: 'We Work Remotely', type: 'api', requiresKey: false, description: 'Remote job listings (free API)' },
      { name: 'Remote OK', type: 'api', requiresKey: false, description: 'Remote job board (free API)' },
      { name: 'Wellfound', type: 'api', requiresKey: false, description: 'Startup jobs (formerly AngelList)' },
      { name: 'Remote.co', type: 'api', requiresKey: false, description: 'Remote job board (free API)' },
      { name: 'Arbeitnow', type: 'api', requiresKey: false, description: 'European job board (free API)' },
      { name: 'FlexJobs', type: 'api', requiresKey: true, description: 'Curated remote/flexible jobs' },
      { name: 'Jooble', type: 'api', requiresKey: true, description: 'Job aggregator API' },
      { name: 'Indeed API', type: 'api', requiresKey: true, description: 'Indeed publisher API' },
      { name: 'Adzuna', type: 'api', requiresKey: true, description: 'Job search API' },
      { name: 'Internshala', type: 'scraping', requiresKey: true, description: 'Indian job portal (via Apify)' },
    ],
  });
});

// Get user's API keys
router.get('/api-keys', async (req: Request, res: Response) => {
  try {
    const userId = getAuthUserId(req);
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { preferences: true },
    });

    // Decrypt API keys with backward compatibility for unencrypted data
    const apiKeys = tryDecryptApiKeys((user?.preferences as any)?.apiKeys);
    
    // Return keys masked (except for newly entered ones)
    const maskedKeys: Record<string, string> = {};
    for (const [service, value] of Object.entries(apiKeys)) {
      if (typeof value === 'string' && value) {
        maskedKeys[service] = value.length > 4 ? '****' + value.slice(-4) : '****';
      } else if (typeof value === 'object' && value !== null) {
        maskedKeys[service] = 'configured';
      }
    }

    res.json({ success: true, data: maskedKeys });
  } catch (error) {
    console.error('Error fetching API keys:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch API keys' });
  }
});

// Save user's API keys (encrypt before storing)
router.post('/api-keys', async (req: Request, res: Response) => {
  try {
    const userId = getAuthUserId(req);
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const { apiKeys } = req.body;
    
    if (!apiKeys || typeof apiKeys !== 'object') {
      res.status(400).json({ success: false, error: 'Invalid API keys format' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { preferences: true },
    });

    const currentPrefs = (user?.preferences as any) || {};
    // Encrypt the API keys before saving to database
    const encryptedApiKeys = encryptApiKeys(apiKeys);
    const updatedPrefs = {
      ...currentPrefs,
      apiKeys: encryptedApiKeys,
    };

    await prisma.user.update({
      where: { id: userId },
      data: { preferences: updatedPrefs },
    });

    res.json({ success: true, data: { message: 'API keys saved successfully' } });
  } catch (error) {
    console.error('Error saving API keys:', error);
    res.status(500).json({ success: false, error: 'Failed to save API keys' });
  }
});

// Get job recommendations
router.get('/recommendations', async (req: Request, res: Response) => {
  try {
    const userId = getAuthUserId(req);
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const limit = Math.min(parseInt(req.query.limit as string) || 10, 20);
    
    const recommendations = await getJobRecommendations(userId, limit);

    res.json({
      success: true,
      data: {
        recommendations,
        count: recommendations.length,
      },
    });
  } catch (error) {
    console.error('Recommendations error:', error);
    res.status(500).json({ success: false, error: 'Failed to get recommendations' });
  }
});

// Get automation stats
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const userId = getAuthUserId(req);
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const applications = await prisma.jobApplication.findMany({
      where: { userId },
      select: {
        status: true,
        matchScore: true,
        applicationDate: true,
        scrapedJob: {
          select: { source: true },
        },
      },
    });

    const statusCounts: Record<string, number> = {
      todo: 0,
      applied: 0,
      interviewing: 0,
      offer: 0,
      rejected: 0,
    };
    const sourceCounts: Record<string, number> = {};
    let totalMatchScore = 0;
    let matchScoreCount = 0;

    for (const app of applications) {
      if (app.status === 'todo' || app.status === 'applied' || app.status === 'interviewing' || app.status === 'offer' || app.status === 'rejected') {
        statusCounts[app.status]++;
      }
      if (app.scrapedJob?.source) {
        sourceCounts[app.scrapedJob.source] = (sourceCounts[app.scrapedJob.source] || 0) + 1;
      }
      if (typeof app.matchScore === 'number') {
        totalMatchScore += app.matchScore;
        matchScoreCount++;
      }
    }

    const fourWeeksAgo = new Date();
    fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
    const weeklyTrends: Record<string, number> = {};
    for (const app of applications) {
      if (app.applicationDate && app.applicationDate >= fourWeeksAgo) {
        const week = getWeekKey(app.applicationDate);
        weeklyTrends[week] = (weeklyTrends[week] || 0) + 1;
      }
    }

    res.json({
      success: true,
      data: {
        total: applications.length,
        statusCounts,
        sourceCounts,
        averageMatchScore: matchScoreCount > 0 ? Math.round(totalMatchScore / matchScoreCount) : 0,
        weeklyTrends,
      },
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ success: false, error: 'Failed to get stats' });
  }
});

function getWeekKey(date: Date): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d.toISOString().split('T')[0];
}

export default router;
