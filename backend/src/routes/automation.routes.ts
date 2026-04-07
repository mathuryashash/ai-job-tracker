import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { triggerAutomation } from '../services/scheduler.service';
import { getAutomationStatus } from '../services/auto-apply.service';
import { searchJobs, getJobDescription } from '../services/job-scraper.service';
import { matchResumeToJob } from '../services/job-matching.service';
import { tailorResume } from '../services/resume-tailoring.service';
import { extractKeywordsFromResume } from '../services/keyword-extraction.service';
import prisma from '../prisma/index';
import { getAuthUserId } from '../middleware/auth';

const router = Router();

const triggerSchema = z.object({
  keywords: z.string().optional(),
  location: z.string().optional(),
  matchThreshold: z.number().min(0).max(100).default(70),
  autoTailorResume: z.boolean().default(true),
  autoGenerateCoverLetter: z.boolean().default(true),
  useAIKeywords: z.boolean().default(true),
});

const searchSchema = z.object({
  keywords: z.string().optional(),
  location: z.string().optional(),
  remote: z.boolean().optional(),
  fullTime: z.boolean().optional(),
});

const matchSchema = z.object({
  jobDescription: z.string().min(1),
});

const tailorSchema = z.object({
  jobDescription: z.string().min(1),
  resumeId: z.string().optional(),
});

const jobUrlSchema = z.string().url().refine((value) => {
  const parsed = new URL(value);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return false;
  }

  const blockedHosts = ['localhost', '127.0.0.1', '::1', '::ffff:127.0.0.1'];
  if (blockedHosts.includes(parsed.hostname)) {
    return false;
  }

  if (parsed.hostname.startsWith('10.')) {
    return false;
  }

  if (parsed.hostname.startsWith('192.168.')) {
    return false;
  }

  if (parsed.hostname.startsWith('172.')) {
    const octets = parsed.hostname.split('.');
    const second = octets.length > 1 ? parseInt(octets[1], 10) : -1;
    if (second >= 16 && second <= 31) {
      return false;
    }
  }

  const lowerHost = parsed.hostname.toLowerCase();
  if (lowerHost.includes(':')) {
    if (
      lowerHost === '::1' ||
      lowerHost.startsWith('fe80:') ||
      lowerHost.startsWith('fc') ||
      lowerHost.startsWith('fd')
    ) {
      return false;
    }
  }

  return true;
}, 'Invalid URL');

router.post('/trigger', async (req: Request, res: Response) => {
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
      data.useAIKeywords
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

    const status = await getAutomationStatus(userId);

    res.json({ success: true, data: status });
  } catch (error) {
    console.error('Status error:', error);
    res.status(500).json({ success: false, error: 'Failed to get automation status' });
  }
});

router.get('/search', async (req: Request, res: Response) => {
  try {
    const userId = getAuthUserId(req);
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const data = searchSchema.parse(req.query);

    const jobs = await searchJobs({
      keywords: data.keywords,
      location: data.location,
      remote: data.remote,
      fullTime: data.fullTime,
    });

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
      { name: 'LinkedIn (Apify)', type: 'scraping', requiresKey: true, description: 'LinkedIn job listings via Apify scraper' },
      { name: 'Indeed (Apify)', type: 'scraping', requiresKey: true, description: 'Indeed job listings via Apify scraper' },
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
    ],
  });
});

export default router;
